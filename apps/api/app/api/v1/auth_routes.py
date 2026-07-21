from datetime import date
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user, get_current_user
from app.core.authorization import raise_owner_scoped_not_found
from app.core.config import settings
from app.core.audit import record_audit_event
from app.core.passwords import hash_password, verify_password
from app.core.tokens import (
    AuthTokenPair,
    issue_auth_tokens,
    list_active_auth_sessions,
    normalize_device_label,
    revoke_auth_session,
    revoke_all_auth_sessions,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.db.session import get_db
from app.models.user import AuditLog, AuthSession, User, UserPreference
from app.schemas.auth import (
    AuthSessionList,
    AuthSessionRead,
    ClerkProfileProvisionRequest,
    LocalAccountMigrationRequest,
    LocalAuthRequest,
    PasswordChangeRequest,
    RefreshTokenRequest,
    SecurityActivityList,
    SecurityActivityRead,
    UserSession,
)

router = APIRouter()
SESSION_LABEL_HEADER = "x-living-nutrition-client"


@router.post("/register", response_model=UserSession)
def register_local_user(
    payload: LocalAuthRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    _require_local_auth_compatibility()
    session = register_or_update_local_user(
        payload,
        db,
        device_label=session_device_label(request),
    )
    record_audit_event(db, event_type="auth.register", user_id=session.id, request=request)
    db.commit()
    return session


@router.post("/login", response_model=UserSession)
def login_local_user(
    payload: LocalAuthRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    _require_local_auth_compatibility()
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

    session = session_from_user(
        user,
        db,
        auth_scheme="jwt",
        include_tokens=True,
        device_label=session_device_label(request),
    )
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


@router.post("/password", response_model=UserSession)
def change_local_password(
    payload: PasswordChangeRequest,
    request: Request,
    current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
) -> UserSession:
    _require_local_auth_compatibility()
    user = db.get(User, current_user.id)

    if (
        current_user.auth_scheme != "jwt"
        or not user
        or user.auth_provider != "local"
        or not user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password changes are available only for signed-in local accounts.",
        )

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password was incorrect.",
        )

    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a new password that differs from your current password.",
        )

    user.password_hash = hash_password(payload.new_password)
    revoke_all_auth_sessions(user.id, db)
    # The replacement session is intentionally the only session left active.
    tokens = issue_auth_tokens(
        user,
        db,
        commit=False,
        device_label=session_device_label(request),
    )
    record_audit_event(db, event_type="auth.password_change", user_id=user.id, request=request)
    db.commit()
    return session_from_user(user, db, auth_scheme="jwt", tokens=tokens)


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


@router.get("/activity", response_model=SecurityActivityList)
def list_security_activity(
    limit: int = Query(default=12, ge=1, le=25),
    current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
) -> SecurityActivityList:
    """Return only safe, account-owned audit fields for the current user."""

    events = db.scalars(
        select(AuditLog)
        .where(AuditLog.user_id == current_user.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    ).all()
    return SecurityActivityList(
        items=[
            SecurityActivityRead(
                id=event.id,
                event_type=event.event_type,
                outcome=event.outcome,
                created_at=event.created_at,
            )
            for event in events
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
        raise_owner_scoped_not_found(
            db,
            request=request,
            user_id=current_user.id,
            detail="Session not found.",
        )

    record_audit_event(db, event_type="auth.session_revoke", user_id=current_user.id, request=request)
    db.commit()


@router.post("/refresh", response_model=UserSession)
def refresh_session(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserSession:
    _require_local_auth_compatibility()
    user, tokens = rotate_refresh_token(
        payload.refresh_token,
        db,
        device_label=session_device_label(request),
    )
    record_audit_event(db, event_type="auth.refresh", user_id=user.id, request=request)
    db.commit()
    return session_from_user(user, db, auth_scheme="jwt", tokens=tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout_session(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    _require_local_auth_compatibility()
    user_id = revoke_refresh_token(payload.refresh_token, db)
    if user_id:
        record_audit_event(db, event_type="auth.logout", user_id=user_id, request=request)
        db.commit()


@router.post("/provision", response_model=UserSession)
def provision_clerk_profile(
    payload: ClerkProfileProvisionRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserSession:
    """Create the API profile only after a Clerk user explicitly continues."""

    if current_user.auth_scheme != "clerk" or not current_user.external_subject:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clerk authentication is required.")

    existing = db.scalar(
        select(User).where(
            User.auth_provider == "clerk",
            User.external_subject == current_user.external_subject,
        )
    )
    if existing:
        return session_from_user(existing, db, auth_scheme="clerk")

    normalized_email = normalize_optional_email(payload.email or current_user.email)
    if normalized_email and db.scalar(select(User).where(User.email == normalized_email)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A local account uses this email. Use the account migration option to keep its data.",
        )

    display_name = (payload.display_name or current_user.display_name or "Living Nutrition User").strip()
    user = User(
        email=normalized_email,
        display_name=display_name[:160] or "Living Nutrition User",
        auth_provider="clerk",
        external_subject=current_user.external_subject,
    )
    db.add(user)
    db.flush()
    db.add(UserPreference(user_id=user.id, locale="en-US", unit_system="metric", timezone="UTC"))
    record_audit_event(db, event_type="auth.clerk_profile_provision", user_id=user.id, request=request)
    db.commit()
    db.refresh(user)
    return session_from_user(user, db, auth_scheme="clerk")


@router.post("/migrate-local-account", response_model=UserSession)
def migrate_local_account(
    payload: LocalAccountMigrationRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserSession:
    """Link a Clerk identity to a verified local account during the approved window."""

    if current_user.auth_scheme != "clerk" or not current_user.external_subject:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clerk authentication is required.")
    if not settings.local_account_migration_enabled:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Local account migration is not available.")
    if settings.local_account_migration_deadline and settings.local_account_migration_deadline < date.today():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="The local account migration window has ended.")

    normalized_email = payload.email.strip().lower()
    local_user = db.scalar(select(User).where(User.email == normalized_email, User.auth_provider == "local"))
    if not local_user or not verify_password(payload.password, local_user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password was incorrect.")

    claimed_user = db.scalar(
        select(User).where(
            User.auth_provider == "clerk",
            User.external_subject == current_user.external_subject,
        )
    )
    if claimed_user and claimed_user.id != local_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Clerk account is already linked to a different Living Nutrition profile.",
        )

    local_user.auth_provider = "clerk"
    local_user.external_subject = current_user.external_subject
    # Clerk owns password recovery after migration; retaining the legacy hash is unnecessary risk.
    local_user.password_hash = None
    revoke_all_auth_sessions(local_user.id, db)
    record_audit_event(db, event_type="auth.local_account_migrated", user_id=local_user.id, request=request)
    db.commit()
    db.refresh(local_user)
    return session_from_user(local_user, db, auth_scheme="clerk")


def register_or_update_local_user(
    payload: LocalAuthRequest,
    db: Session,
    *,
    device_label: str | None = None,
) -> UserSession:
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
    return session_from_user(
        user,
        db,
        auth_scheme="jwt",
        include_tokens=True,
        device_label=device_label,
    )


def session_from_user(
    user: User | None,
    db: Session,
    auth_scheme: str,
    include_tokens: bool = False,
    tokens: AuthTokenPair | None = None,
    device_label: str | None = None,
) -> UserSession:
    if not user:
        raise RuntimeError("Authenticated user record was not available.")

    token_pair = tokens or (
        issue_auth_tokens(user, db, device_label=device_label) if include_tokens else None
    )

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
        device_label=normalize_device_label(auth_session.device_label),
        created_at=auth_session.created_at,
        last_used_at=auth_session.last_used_at,
        expires_at=auth_session.expires_at,
        is_current=auth_session.id == current_session_id,
    )


def session_device_label(request: Request) -> str | None:
    return request.headers.get(SESSION_LABEL_HEADER)


def normalize_optional_email(value: str | None) -> str | None:
    normalized = value.strip().lower() if value else ""
    return normalized or None


def _require_local_auth_compatibility() -> None:
    if settings.identity_provider == "clerk" or not settings.allow_legacy_local_tokens:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Local account sign-in is no longer available. Use Clerk to sign in.",
        )
