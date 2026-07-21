from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.core.clerk as clerk_module
from app.core.config import settings


def configure_clerk_verification(monkeypatch: pytest.MonkeyPatch, jwks: dict[str, object]) -> None:
    monkeypatch.setattr(settings, "identity_provider", "clerk")
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.example.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "clerk_issuer", "https://clerk.example.test")
    monkeypatch.setattr(settings, "clerk_audience", "living-nutrition")
    monkeypatch.setattr(clerk_module, "_load_jwks", lambda *, force_refresh=False: jwks)


def test_verify_clerk_token_accepts_matching_rs256_jwk(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk["kid"] = "current-key"
    configure_clerk_verification(monkeypatch, {"keys": [jwk]})

    token = jwt.encode(
        {
            "sub": "user_123",
            "sid": "sess_123",
            "email": "member@example.com",
            "name": "Nutrition Member",
            "iss": settings.clerk_issuer,
            "aud": settings.clerk_audience,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "current-key"},
    )

    identity = clerk_module.verify_clerk_token(token)

    assert identity.subject == "user_123"
    assert identity.session_id == "sess_123"
    assert identity.email == "member@example.com"
    assert identity.display_name == "Nutrition Member"


def test_verify_clerk_token_rejects_non_rs256_before_key_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    configure_clerk_verification(monkeypatch, {"keys": []})
    token = jwt.encode(
        {"sub": "user_123", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        "test-hmac-secret-that-is-at-least-thirty-two-characters",
        algorithm="HS256",
        headers={"kid": "untrusted-key"},
    )

    with pytest.raises(HTTPException) as error:
        clerk_module.verify_clerk_token(token)

    assert error.value.status_code == 401
    assert error.value.detail == "Clerk session token uses an unsupported signing algorithm."
