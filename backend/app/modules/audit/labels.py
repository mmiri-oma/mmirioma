"""Names for the records an audit row points at (``target_label``, #296).

``GET /admin/audit-logs`` shows "Suspended a driver" as a row; the label says
which driver. Labels are looked up when the page is read and never stored in
``audit_logs``: the audit rows are immutable, so a stored name could not be
removed when the record is anonymized (NFR-004, privacy tool). Reading is
admin-only and the log itself is not audited.

This is the one place in the audit module that reads other modules' tables.
It is a read-only projection of a name or reference per record, kept here so
no business module has to know the audit log exists.
"""

import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.auth.retention import is_anonymized_phone
from app.modules.customers.models import SupportRequest
from app.modules.orders.models import Order
from app.modules.payments.models import CashCollection, CashRemittance
from app.modules.pricing.models import ServiceZone
from app.modules.sources.models import WaterSource

type LabelKey = tuple[str, uuid.UUID]
type _Lookup = Callable[[AsyncSession, list[uuid.UUID]], Awaitable[dict[uuid.UUID, str | None]]]


async def _order_references(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(select(Order.id, Order.reference).where(Order.id.in_(ids)))
    return {record_id: reference for record_id, reference in rows}


async def _collection_order_references(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(
        select(CashCollection.id, Order.reference)
        .join(Order, Order.id == CashCollection.order_id)
        .where(CashCollection.id.in_(ids))
    )
    return {record_id: reference for record_id, reference in rows}


async def _support_references(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(
        select(SupportRequest.id, SupportRequest.reference).where(SupportRequest.id.in_(ids))
    )
    return {record_id: reference for record_id, reference in rows}


async def _zone_names(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(
        select(ServiceZone.id, ServiceZone.name).where(ServiceZone.id.in_(ids))
    )
    return {record_id: name for record_id, name in rows}


async def _source_names(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(
        select(WaterSource.id, WaterSource.name).where(WaterSource.id.in_(ids))
    )
    return {record_id: name for record_id, name in rows}


def _account_name(name: str, phone: str) -> str | None:
    """The account's name, or None once the account was anonymized.

    An anonymized account keeps a placeholder name ("Former rider or driver"),
    which says nothing about the record, so the label is None and the screen
    falls back to the short id.
    """
    return None if is_anonymized_phone(phone) else name


async def _account_names(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(select(User.id, User.name, User.phone).where(User.id.in_(ids)))
    return {record_id: _account_name(name, phone) for record_id, name, phone in rows}


async def _remittance_driver_names(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    rows = await session.execute(
        select(CashRemittance.id, User.name, User.phone)
        .join(User, User.id == CashRemittance.driver_id)
        .where(CashRemittance.id.in_(ids))
    )
    return {record_id: _account_name(name, phone) for record_id, name, phone in rows}


# One lookup per target type (#296). Every other type gets no label: an
# address is personal data, a deletion request and a retention review have no
# short name, and a price list version has no name of its own.
_LOOKUPS: dict[str, _Lookup] = {
    "order": _order_references,
    "cash_collection": _collection_order_references,
    "support_request": _support_references,
    "service_zone": _zone_names,
    "water_source": _source_names,
    "driver": _account_names,
    "user": _account_names,
    "cash_remittance": _remittance_driver_names,
}


async def target_labels(
    session: AsyncSession, targets: Iterable[tuple[str, uuid.UUID]]
) -> dict[LabelKey, str | None]:
    """Return the label of each ``(target_type, target_id)`` of a page.

    Runs one query per target type present in the page, never one per row.
    A record that no longer exists, or whose account was anonymized, maps to
    ``None``: never the old name and never an error, so the row stays readable
    (docs/api/admin-operations.md, ``target_label``).

    Args:
        session: Database session.
        targets: The ``(target_type, target_id)`` of every row on the page.

    Returns:
        A label, or ``None``, for every target given.
    """
    wanted: dict[str, set[uuid.UUID]] = defaultdict(set)
    labels: dict[LabelKey, str | None] = {}
    for target_type, target_id in targets:
        labels[(target_type, target_id)] = None
        if target_type in _LOOKUPS:
            wanted[target_type].add(target_id)
    for target_type, ids in wanted.items():
        found: dict[uuid.UUID, Any] = await _LOOKUPS[target_type](session, sorted(ids))
        for record_id, label in found.items():
            labels[(target_type, record_id)] = label
    return labels
