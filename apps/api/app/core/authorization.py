"""Owner-scoped resource denial helpers.

The API intentionally returns the same 404 for a missing resource and one that
belongs to another account. That prevents identifier probing while preserving a
minimal operational event for protected resource access failures.
"""

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event


def raise_owner_scoped_not_found(
    db: Session,
    *,
    request: Request,
    user_id: str,
    detail: str,
) -> None:
    """Persist a safe denial event, then raise a non-enumerating 404.

    The event deliberately contains no requested resource ID, route parameter,
    request body, or ownership distinction. It is committed only from lookup
    paths before a route mutates a user resource.
    """

    record_audit_event(
        db,
        event_type="authorization.owner_access_denied",
        user_id=user_id,
        request=request,
        outcome="not_found_or_not_owned",
    )
    db.commit()
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
