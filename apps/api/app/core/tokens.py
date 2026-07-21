import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
from fastapi import HTTPException, status
from jwt.exceptions import PyJWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import AuthSession, User

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_PREFIX = "lnr1"
SUPPORTED_DEVICE_LABELS = {
    "living nutrition on ios": "Living Nutrition on iOS",
    "living nutrition on android": "Living Nutrition on Android",
    "living nutrition on web": "Living Nutrition on web",
}


@dataclass(frozen=True)
class AuthTokenPair:
    access_token: str
    refresh_token: str
    access_token_expires_at: datetime


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: str
    session_id: str


def issue_auth_tokens(
    user: User,
    db: Session,
    *,
    commit: bool = True,
    device_label: str | None = None,
) -> AuthTokenPair:
    refresh_token = _new_refresh_token()
    now = utc_now()
    auth_session = AuthSession(
        id=str(uuid4()),
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(refresh_token),
        device_label=normalize_device_label(device_label),
        expires_at=now + timedelta(days=settings.jwt_refresh_token_days),
    )
    db.add(auth_session)
    if commit:
        db.commit()
    else:
        db.flush()

    return _build_token_pair(user.id, auth_session.id, refresh_token, now=now)


def rotate_refresh_token(
    refresh_token: str,
    db: Session,
    *,
    device_label: str | None = None,
) -> tuple[User, AuthTokenPair]:
    auth_session = get_valid_refresh_session(refresh_token, db)
    user = db.get(User, auth_session.user_id)

    if not user:
        _reject_refresh_token()

    auth_session.revoked_at = utc_now()
    auth_session.last_used_at = auth_session.revoked_at
    new_refresh_token = _new_refresh_token()
    new_session = AuthSession(
        id=str(uuid4()),
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(new_refresh_token),
        device_label=normalize_device_label(device_label)
        or normalize_device_label(auth_session.device_label),
        expires_at=utc_now() + timedelta(days=settings.jwt_refresh_token_days),
    )
    db.add(new_session)
    db.commit()

    return user, _build_token_pair(user.id, new_session.id, new_refresh_token)


def revoke_refresh_token(refresh_token: str, db: Session) -> str | None:
    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == hash_refresh_token(refresh_token))
    )

    if not auth_session or auth_session.revoked_at is not None:
        return None

    auth_session.revoked_at = utc_now()
    db.commit()
    return auth_session.user_id


def list_active_auth_sessions(user_id: str, db: Session) -> list[AuthSession]:
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.created_at.desc())
    ).all()
    now = utc_now()
    return [session for session in sessions if _as_utc(session.expires_at) > now]


def revoke_auth_session(session_id: str, user_id: str, db: Session) -> bool:
    auth_session = db.get(AuthSession, session_id)

    if (
        not auth_session
        or auth_session.user_id != user_id
        or auth_session.revoked_at is not None
        or _as_utc(auth_session.expires_at) <= utc_now()
    ):
        return False

    auth_session.revoked_at = utc_now()
    db.commit()
    return True


def revoke_all_auth_sessions(user_id: str, db: Session) -> int:
    """Invalidate every refresh session before issuing replacement credentials."""

    now = utc_now()
    sessions = db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    ).all()

    for auth_session in sessions:
        auth_session.revoked_at = now
        auth_session.last_used_at = now

    return len(sessions)


def decode_access_token(token: str) -> AccessTokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
    except PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from exc

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unsupported authentication token.",
        )

    user_id = str(payload.get("sub") or "")
    session_id = str(payload.get("sid") or "")
    try:
        UUID(user_id)
        UUID(session_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token claims.",
        ) from exc

    return AccessTokenClaims(user_id=user_id, session_id=session_id)


def access_session_is_active(session_id: str, user_id: str, db: Session) -> bool:
    auth_session = db.get(AuthSession, session_id)
    return bool(
        auth_session
        and auth_session.user_id == user_id
        and auth_session.revoked_at is None
        and _as_utc(auth_session.expires_at) > utc_now()
    )


def get_valid_refresh_session(refresh_token: str, db: Session) -> AuthSession:
    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == hash_refresh_token(refresh_token))
    )

    if (
        not auth_session
        or auth_session.revoked_at is not None
        or _as_utc(auth_session.expires_at) <= utc_now()
    ):
        _reject_refresh_token()

    return auth_session


def hash_refresh_token(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()


def normalize_device_label(value: str | None) -> str | None:
    """Allow only app-owned labels; never persist raw client identifiers."""

    if not value:
        return None

    normalized = " ".join(value.split())
    if not normalized:
        return None

    return SUPPORTED_DEVICE_LABELS.get(normalized.casefold())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _build_token_pair(
    user_id: str,
    session_id: str,
    refresh_token: str,
    *,
    now: datetime | None = None,
) -> AuthTokenPair:
    issued_at = now or utc_now()
    expires_at = issued_at + timedelta(minutes=settings.jwt_access_token_minutes)
    access_token = jwt.encode(
        {
            "sub": user_id,
            "sid": session_id,
            "type": ACCESS_TOKEN_TYPE,
            "iat": issued_at,
            "exp": expires_at,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    return AuthTokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_at=expires_at,
    )


def _new_refresh_token() -> str:
    return f"{REFRESH_TOKEN_PREFIX}.{secrets.token_urlsafe(48)}"


def _reject_refresh_token() -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh session is invalid or expired. Please sign in again.",
    )
