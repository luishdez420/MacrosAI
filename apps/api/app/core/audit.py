"""Minimal audit events for sensitive account operations.

Audit records intentionally exclude credentials, tokens, food details, images, and
free-form request payloads. They support operational accountability without
turning the audit table into another store of sensitive nutrition data.
"""

from __future__ import annotations

import hashlib

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.middleware import get_request_id
from app.models.user import AuditDelivery, AuditLog


def record_audit_event(
    db: Session,
    *,
    event_type: str,
    user_id: str | None,
    request: Request | None = None,
    outcome: str = "success",
) -> AuditLog:
    event = AuditLog(
        event_type=event_type,
        user_id=user_id,
        outcome=outcome,
        request_id=get_request_id(request) if request else None,
        client_fingerprint=client_fingerprint(request) if request else None,
    )
    db.add(event)
    # Make the event available to later statements in the same sensitive-operation transaction.
    db.flush()
    # The outbox is committed with the originating sensitive-operation event,
    # so a worker can retry external delivery without blocking user requests.
    db.add(AuditDelivery(audit_log_id=event.id))
    return event


def client_fingerprint(request: Request | None) -> str | None:
    if not request or not request.client:
        return None

    # Keep a one-way operational correlation value rather than a raw IP address.
    return hashlib.sha256(request.client.host.encode("utf-8")).hexdigest()
