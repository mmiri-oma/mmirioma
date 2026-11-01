"""Audit log persistence: the ``audit_logs`` table (SRS §5, NFR-004).

One row per auditable administrative action, written in the same transaction
as the action itself, so an action is never recorded without its audit row
or the other way round. The first actions are the hold review decisions
(docs/api/deliveries.md, "Admin hold review endpoints", decision 6); later
NFR-004 features (payments, refunds, documents) add their own.

``metadata`` holds small identifiers only (ids and kinds). Never put phone
numbers, addresses, notes or other personal data in it (CLAUDE.md,
Security): the notes stay on the business record, where access is
controlled.

One exception (technical lead, #293, 2026-10-31): the staff reason of a
decision about a driver (``driver_approved``, ``driver_suspended``,
``driver_activated``, ``driver_deactivated``) is stored in ``metadata`` under
``reason``, because for those actions the audit row is the only place the
reason is kept. Such a reason is a staff note and must not contain customer
data; the audit endpoint is admin-only. Add no other reason without the same
decision (docs/api/admin-operations.md, ``GET /admin/audit-logs``).

When that driver is anonymized (NFR-003, #298), the reason is removed from
those rows and ``reason_removed: true`` is set in its place (boolean, so the
"ids and kinds only" rule holds): see ``audit.service.clear_driver_reasons``.
"""

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, TimestampMixin, UUIDPrimaryKeyMixin

ACTION_MAX_LENGTH = 60
TARGET_TYPE_MAX_LENGTH = 30


class AuditLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One auditable action.

    Attributes:
        actor_id: The user who acted.
        action: What they did, e.g. ``proof_override_approved``.
        target_type: The kind of record acted on, e.g. ``order``.
        target_id: Its id.
        details: Small JSON metadata (column ``metadata``); ids and kinds
            only, never personal data. The one exception is ``reason`` on the
            four driver decisions named above.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_target", "target_type", "target_id"),)

    actor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(ACTION_MAX_LENGTH))
    target_type: Mapped[str] = mapped_column(String(TARGET_TYPE_MAX_LENGTH))
    target_id: Mapped[uuid.UUID]
    # ``metadata`` is reserved on declarative classes, so the attribute is
    # named ``details``; the column keeps the SRS §5 name.
    details: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
