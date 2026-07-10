from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.user import User, UserPreference
from app.core.tokens import access_session_is_active, decode_access_token

DEV_USER_ID = "00000000-0000-4000-8000-000000000001"
LOCAL_TOKEN_PREFIX = "local:"


@dataclass(frozen=True)
class CurrentUser:
    id: str
    auth_scheme: str
    session_id: str | None = None


def get_current_user(
    authorization: str | None = Header(default=None),
) -> CurrentUser:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

        if token.startswith(LOCAL_TOKEN_PREFIX) and settings.allow_legacy_local_tokens:
            user_id = token.removeprefix(LOCAL_TOKEN_PREFIX)
            try:
                UUID(user_id)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid local authentication token.",
                )

            return CurrentUser(id=user_id, auth_scheme="local-token")

        claims = decode_access_token(token)
        return CurrentUser(id=claims.user_id, auth_scheme="jwt", session_id=claims.session_id)

    if settings.allow_dev_auth:
        return CurrentUser(id=DEV_USER_ID, auth_scheme="dev")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication is required.",
    )


def ensure_current_user(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CurrentUser:
    user = db.get(User, current_user.id)

    if current_user.auth_scheme == "jwt" and (
        not current_user.session_id
        or not access_session_is_active(current_user.session_id, current_user.id, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session is no longer active. Please sign in again.",
        )

    if not user:
        if current_user.auth_scheme in {"jwt", "local-token"}:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Local session was not found. Please sign in again.",
            )

        db.add(
            User(
                id=current_user.id,
                email="dev@living-nutrition.local",
                display_name="Local Dev User",
                auth_provider=current_user.auth_scheme,
                external_subject="local-dev",
            )
        )
        db.add(
            UserPreference(
                user_id=current_user.id,
                locale="en-US",
                unit_system="metric",
                timezone="UTC",
            )
        )
        db.commit()

    return current_user
