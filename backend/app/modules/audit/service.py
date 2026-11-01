"""Write and read audit log rows (NFR-004)."""

import uuid
from collections.abc import Collection
from typing import Any

from sqlalchemy import ColumnElement, Text, cast, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.auth.models import User

#: Audit rows about a driver, whose ``details.reason`` is the staff note of the decision
#: (``partners/directory.py``; the exception to "ids and kinds only" in ``audit.models``).
DRIVER_AUDIT_TARGET_TYPE = "driver"
DRIVER_DECISION_ACTIONS = (
    "driver_approved",
    "driver_suspended",
    "driver_activated",
    "driver_deactivated",
)


def record(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Add an audit row to the caller's transaction. Does not commit.

    The caller commits it together with the action, so both happen or
    neither does.

    Args:
        session: The session the action is written in.
        actor_id: The user who acted.
        action: Snake-case action name, e.g. ``proof_override_approved``.
        target_type: Kind of record, e.g. ``order``.
        target_id: Its id.
        details: Ids and kinds only; never personal data (phones,
            addresses, notes).

    Returns:
        The new, unflushed row.
    """
    row = AuditLog(
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    session.add(row)
    return row


async def actors_with_rows(
    session: AsyncSession, *, user_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Return which of these users acted in at least one audit row.

    ``audit_logs.actor_id`` is RESTRICT, so such an account cannot be
    deleted without losing its NFR-004 records; the privacy tool anonymizes
    it instead.

    Args:
        session: Database session.
        user_ids: The accounts to check.

    Returns:
        The ids that appear as an actor.
    """
    if not user_ids:
        return set()
    rows = await session.scalars(
        select(AuditLog.actor_id).where(AuditLog.actor_id.in_(user_ids)).distinct()
    )
    return set(rows)


async def clear_driver_reasons(session: AsyncSession, *, driver_id: uuid.UUID) -> int:
    """Replace the staff reason on a driver's decision rows with a marker.

    Used when the driver is anonymized (NFR-003, #298). A reason is a free-text
    staff note that can name the driver, so it must not stay readable. On the
    four driver decision rows about this account, ``details.reason`` is
    removed and ``details.reason_removed`` is set to true, so an auditor can
    tell "a reason was given and removed" from "no reason was given"
    (NFR-004). The row, its actor, time, action and every other key stay.
    Runs in the caller's transaction and does not commit.

    Args:
        session: The session the anonymization runs in.
        driver_id: The driver's account id (the rows' ``target_id``).

    Returns:
        How many rows had a reason removed (a count, no text).
    """
    result = await session.execute(
        update(AuditLog)
        .where(
            AuditLog.target_type == DRIVER_AUDIT_TARGET_TYPE,
            AuditLog.target_id == driver_id,
            AuditLog.action.in_(DRIVER_DECISION_ACTIONS),
            AuditLog.details.has_key("reason"),
        )
        .values(
            details=AuditLog.details.op("-")(cast(literal("reason"), Text)).op("||")(
                literal({"reason_removed": True}, type_=JSONB)
            )
        )
        .execution_options(synchronize_session=False)
    )
    return result.rowcount  # type: ignore[attr-defined, no-any-return]


async def list_logs(
    session: AsyncSession,
    *,
    target_type: str | None,
    target_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[tuple[AuditLog, User]], int]:
    """Return a page of audit rows with their actors, newest first.

    ``GET /admin/audit-logs`` (docs/api/admin-operations.md). With
    ``target_type`` and ``target_id`` (the router requires both or neither),
    only that record's rows. Reading the log is not itself audited.

    Args:
        session: Database session.
        target_type: Kind of record, e.g. ``order``, or None for every row.
        target_id: Its id, or None.
        limit: Page size.
        offset: Rows to skip.

    Returns:
        ``(rows, total)``: each row with the user who acted.
    """
    filters: list[ColumnElement[bool]] = []
    if target_type is not None and target_id is not None:
        filters = [AuditLog.target_type == target_type, AuditLog.target_id == target_id]
    rows = await session.execute(
        select(AuditLog, User)
        .join(User, User.id == AuditLog.actor_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    total = await session.scalar(select(func.count()).select_from(AuditLog).where(*filters))
    return [(log, actor) for log, actor in rows], total or 0
