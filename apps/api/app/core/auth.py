from dataclasses import dataclass, replace
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.clerk import ClerkIdentity, verify_clerk_token
from app.models.user import User, UserPreference
from app.core.tokens import access_session_is_active, decode_access_token

DEV_USER_ID = "00000000-0000-4000-8000-000000000001"
LOCAL_TOKEN_PREFIX = "local:"


@dataclass(frozen=True)
class CurrentUser:
    id: str | None
    auth_scheme: str
    session_id: str | None = None
    external_subject: str | None = None
    email: str | None = None
    display_name: str | None = None


def get_current_user(
    authorization: str | None = Header(default=None),
) -> CurrentUser:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

        if settings.identity_provider == "clerk":
            identity = verify_clerk_token(token)
            return _current_clerk_user(identity)

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
    if current_user.auth_scheme == "clerk":
        user = db.scalar(
            select(User).where(
                User.auth_provider == "clerk",
                User.external_subject == current_user.external_subject,
            )
        )
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Set up your Living Nutrition profile before accessing saved data.",
            )
        return replace(current_user, id=user.id)

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


def ensure_clerk_admin(
    current_user: CurrentUser = Depends(ensure_current_user),
) -> CurrentUser:
    """Allow sensitive operational review only for configured Clerk subjects."""

    if (
        current_user.auth_scheme != "clerk"
        or not current_user.external_subject
        or current_user.external_subject not in settings.admin_clerk_subject_set
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to review audit events.",
        )
    return current_user


def _current_clerk_user(identity: ClerkIdentity) -> CurrentUser:
    return CurrentUser(
        id=None,
        auth_scheme="clerk",
        session_id=identity.session_id,
        external_subject=identity.subject,
        email=identity.email,
        display_name=identity.display_name,
    )
