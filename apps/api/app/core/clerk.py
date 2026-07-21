"""Minimal Clerk JWT verification for the API authorization boundary.

Clerk owns credentials, recovery, and token issuance. This module only verifies
signed session tokens through the configured JWKS endpoint before API routes map
the Clerk subject to Living Nutrition's internal user record.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status
from jwt import PyJWK
from jwt.exceptions import PyJWTError

from app.core.config import settings


@dataclass(frozen=True)
class ClerkIdentity:
    subject: str
    session_id: str | None
    email: str | None
    display_name: str | None


_jwks_cache: dict[str, Any] | None = None
_jwks_expires_at: datetime | None = None
_jwks_lock = Lock()
CLERK_SESSION_JWT_ALGORITHM = "RS256"


def verify_clerk_token(token: str) -> ClerkIdentity:
    """Verify a Clerk-issued JWT and return only safe identity claims."""

    if settings.identity_provider != "clerk":
        raise _unauthorized("Clerk authentication is not enabled for this environment.")

    if not settings.clerk_jwks_url or not settings.clerk_issuer:
        raise _unauthorized("Clerk authentication is not configured on this server.")

    try:
        header = jwt.get_unverified_header(token)
        key_id = str(header.get("kid") or "")
    except PyJWTError as exc:
        raise _unauthorized("Invalid Clerk session token.") from exc

    if not key_id:
        raise _unauthorized("Clerk session token is missing a signing key identifier.")
    if header.get("alg") != CLERK_SESSION_JWT_ALGORITHM:
        raise _unauthorized("Clerk session token uses an unsupported signing algorithm.")

    key = next((entry for entry in _load_jwks().get("keys", []) if entry.get("kid") == key_id), None)
    if not key:
        # A key can rotate between the cached response and a session refresh.
        key = next((entry for entry in _load_jwks(force_refresh=True).get("keys", []) if entry.get("kid") == key_id), None)
    if not key:
        raise _unauthorized("Clerk session token was signed by an unknown key.")

    try:
        verification_key = PyJWK.from_dict(key).key
        options = {"verify_aud": bool(settings.clerk_audience)}
        claims = jwt.decode(
            token,
            verification_key,
            algorithms=[CLERK_SESSION_JWT_ALGORITHM],
            issuer=settings.clerk_issuer,
            audience=settings.clerk_audience,
            options=options,
        )
    except (PyJWTError, TypeError, ValueError) as exc:
        raise _unauthorized("Clerk session token is invalid or expired.") from exc

    subject = str(claims.get("sub") or "").strip()
    if not subject:
        raise _unauthorized("Clerk session token does not identify a user.")

    return ClerkIdentity(
        subject=subject,
        session_id=_optional_claim(claims, "sid"),
        email=_optional_claim(claims, "email"),
        display_name=_optional_claim(claims, "name"),
    )


def _load_jwks(*, force_refresh: bool = False) -> dict[str, Any]:
    global _jwks_cache, _jwks_expires_at

    now = datetime.now(timezone.utc)
    with _jwks_lock:
        if not force_refresh and _jwks_cache and _jwks_expires_at and now < _jwks_expires_at:
            return _jwks_cache

        try:
            response = httpx.get(str(settings.clerk_jwks_url), timeout=5.0)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise _unauthorized("Identity verification is temporarily unavailable. Please try again.") from exc

        if not isinstance(payload, dict) or not isinstance(payload.get("keys"), list):
            raise _unauthorized("Identity verification returned an invalid key set.")

        _jwks_cache = payload
        _jwks_expires_at = now + timedelta(seconds=settings.clerk_jwks_cache_seconds)
        return payload


def _optional_claim(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    return str(value).strip() if value else None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
