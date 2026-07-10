from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.core.audit import record_audit_event
from app.core.passwords import hash_password, verify_password
from app.core.tokens import (
    AuthTokenPair,
    issue_auth_tokens,
    list_active_auth_sessions,
    revoke_auth_session,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.db.session import get_db
from app.models.user import AuthSession, User, UserPreference
from app.schemas.auth import (
    AuthSessionList,
    AuthSessionRead,
    LocalAuthRequest,
    RefreshTokenRequest,
    UserSession,
)

router = APIRouter()


@router.post("/register", response_model=UserSession)
def register_local_user(
    payload: LocalAuthRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    session = register_or_update_local_user(payload, db)
    record_audit_event(db, event_type="auth.register", user_id=session.id, request=request)
    db.commit()
    return session


@router.post("/login", response_model=UserSession)
def login_local_user(
    payload: LocalAuthRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    normalized_email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized_email))

    if not user or user.auth_provider != "local" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password was incorrect.",
        )

    if payload.display_name:
        user.display_name = payload.display_name
        db.commit()
        db.refresh(user)

    session = session_from_user(user, db, auth_scheme="jwt", include_tokens=True)
    record_audit_event(db, event_type="auth.login", user_id=user.id, request=request)
    db.commit()
    return session


@router.get("/session", response_model=UserSession)
def get_session(
    current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
) -> UserSession:
    user = db.get(User, current_user.id)
    return session_from_user(user, db, auth_scheme=current_user.auth_scheme, include_tokens=False)


@router.get("/sessions", response_model=AuthSessionList)
def list_auth_sessions(
    current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
) -> AuthSessionList:
    sessions = list_active_auth_sessions(current_user.id, db)
    return AuthSessionList(
        items=[
            auth_session_to_read(session, current_user.session_id)
            for session in sessions
        ]
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_other_auth_session(
    session_id: str,
    request: Request,
    current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
) -> None:
    if current_user.session_id == session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use sign out to revoke the current session.",
        )

    if not revoke_auth_session(session_id, current_user.id, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    record_audit_event(db, event_type="auth.session_revoke", user_id=current_user.id, request=request)
    db.commit()


@router.post("/refresh", response_model=UserSession)
def refresh_session(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    user, tokens = rotate_refresh_token(payload.refresh_token, db)
    record_audit_event(db, event_type="auth.refresh", user_id=user.id, request=request)
    db.commit()
    return session_from_user(user, db, auth_scheme="jwt", tokens=tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout_session(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    user_id = revoke_refresh_token(payload.refresh_token, db)
    if user_id:
        record_audit_event(db, event_type="auth.logout", user_id=user_id, request=request)
        db.commit()


def register_or_update_local_user(payload: LocalAuthRequest, db: Session) -> UserSession:
    normalized_email = payload.email.strip().lower()
    user_id = str(uuid5(NAMESPACE_URL, f"living-nutrition:{normalized_email}"))
    user = db.scalar(select(User).where(User.id == user_id))

    if not user:
        user = User(
            id=user_id,
            email=normalized_email,
            display_name=payload.display_name or normalized_email.split("@")[0],
            password_hash=hash_password(payload.password),
            auth_provider="local",
            external_subject=normalized_email,
        )
        db.add(user)
        db.add(
            UserPreference(
                user_id=user_id,
                locale="en-US",
                unit_system="metric",
                timezone="UTC",
            )
        )
    else:
        if user.password_hash and not verify_password(payload.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email or password was incorrect.",
            )

        user.email = normalized_email
        if payload.display_name:
            user.display_name = payload.display_name
        if not user.password_hash:
            user.password_hash = hash_password(payload.password)
        user.auth_provider = "local"
        user.external_subject = normalized_email

    db.commit()
    db.refresh(user)
    return session_from_user(user, db, auth_scheme="jwt", include_tokens=True)


def session_from_user(
    user: User | None,
    db: Session,
    auth_scheme: str,
    include_tokens: bool = False,
    tokens: AuthTokenPair | None = None,
) -> UserSession:
    if not user:
        raise RuntimeError("Authenticated user record was not available.")

    token_pair = tokens or (issue_auth_tokens(user, db) if include_tokens else None)

    return UserSession(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        token=token_pair.access_token if token_pair else None,
        access_token=token_pair.access_token if token_pair else None,
        refresh_token=token_pair.refresh_token if token_pair else None,
        access_token_expires_at=token_pair.access_token_expires_at if token_pair else None,
        auth_scheme=auth_scheme,
    )


def auth_session_to_read(auth_session: AuthSession, current_session_id: str | None) -> AuthSessionRead:
    return AuthSessionRead(
        id=auth_session.id,
        created_at=auth_session.created_at,
        last_used_at=auth_session.last_used_at,
        expires_at=auth_session.expires_at,
        is_current=auth_session.id == current_session_id,
    )
