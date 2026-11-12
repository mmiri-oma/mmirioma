"""Water source records: add sources and manage their category activations.

Used by the command-line tool (:mod:`app.modules.sources.cli`, pilot
fallback F1) and by the admin endpoints (:mod:`app.modules.sources.admin`,
#309). Each change is
written with one ``audit_logs`` row in the same transaction (NFR-004), with
the technical lead's admin account as the actor. Audit metadata holds ids
and statuses only: never the report reference, the reason text or the cost.

Business rules (FR-012, BR-10, contract "Order confirmation endpoints"):

- A source serves a category only through an activation
  (:class:`~app.modules.sources.models.WaterSourceCategory`). Activating
  records the laboratory report reference, the last approved date and the
  supplier's cost per litre in kobo.
- Suspending (after a safety concern) and revoking keep the row and record a
  reason; eligibility then reports ``suspended`` or ``revoked``. Activating
  again clears the reason.
- Nothing here is removed: activations are history the reviews rely on.
- A source needs a kind before it can be activated (#407, decision 407-2):
  :func:`activate` raises :class:`KindRequiredError`, the command line and the
  admin screen both refuse.
- The cost per litre can be changed on its own (:func:`change_cost`). Quotes
  store their amounts and orders keep their quote's snapshot (FR-024, T-09),
  so only new quotes read the new cost.
- Supplier contact details (#407) are admin-only and never written to an
  audit row: the row names the changed fields, never their values.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any

from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit_service
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.sources.eligibility import eligibility_reasons
from app.modules.sources.locations import SourceLocation, source_locations
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)

AUDIT_TARGET_TYPE = "water_source"

__all__ = ["SourceLocation"]  # re-exported: callers import it from here


class LitresRangeError(ValueError):
    """An edit would leave the minimum litres above the maximum (#407)."""


class KindRequiredError(Exception):
    """The source has no kind, so it cannot be activated (#407, decision 407-2)."""


class _Unset:
    """Marks a value that was not sent, so ``None`` can mean "clear it"."""


UNSET = _Unset()


@dataclass(frozen=True)
class SourceWithActivations:
    """A source and its activations, each with its category.

    ``location`` is the pickup point, or None when an administrator has not set one.
    """

    source: WaterSource
    activations: list[tuple[WaterSourceCategory, WaterCategory]]
    location: SourceLocation | None = None


@dataclass(frozen=True)
class SupplierDetails:
    """The #407 fields of a source, as a request sets them.

    Attributes:
        contact_name: Who to call at the source, or None.
        contact_phone: Their number, already normalized to E.164, or None.
        min_litres_per_order: Smallest complete order in litres, or None.
        max_litres_per_order: Largest complete order in litres, or None.
        is_available: Whether the source takes new work.
        vehicle_kinds: ``keke`` and/or ``tanker``, at least one.
    """

    contact_name: str | None = None
    contact_phone: str | None = None
    min_litres_per_order: int | None = None
    max_litres_per_order: int | None = None
    is_available: bool = True
    vehicle_kinds: tuple[str, ...] = ("keke", "tanker")


def _point(location: SourceLocation) -> WKTElement:
    return WKTElement(f"POINT({location.longitude!r} {location.latitude!r})", srid=4326)


def _apply_vehicle_kinds(source: WaterSource, vehicle_kinds: Iterable[str]) -> None:
    kinds = set(vehicle_kinds)
    if not kinds or not kinds <= {"keke", "tanker"}:
        raise ValueError("vehicle_kinds must be one or both of keke and tanker")
    source.serves_keke = "keke" in kinds
    source.serves_tanker = "tanker" in kinds


async def get_acting_admin(session: AsyncSession, *, phone: str) -> User:
    """Return the active admin account recorded as the actor of a change.

    Args:
        session: Database session.
        phone: Normalized E.164 phone number of the admin.

    Returns:
        The admin.

    Raises:
        LookupError: No active admin account has this phone.
    """
    user = await auth_service.get_user_by_phone(session, phone)
    if user is None or user.role is not UserRole.ADMIN or not user.is_active:
        raise LookupError("no active admin account has this phone")
    return user


async def add_source(
    session: AsyncSession,
    *,
    actor: User,
    name: str,
    approximate_location: str,
    is_simulated: bool = False,
    kind: WaterSourceKind | None = None,
    location: SourceLocation | None = None,
    details: SupplierDetails | None = None,
) -> WaterSource:
    """Add a water source (FR-011). Commits.

    Args:
        session: Database session.
        actor: The admin making the change.
        name: Supplier or source name (validated by the caller).
        approximate_location: Pickup location in words.
        is_simulated: True for demo data (BR-09).
        kind: Ninth Mile or borehole (#21), or None to set it later.
        location: The pickup point (#385), or None to set it later.
        details: Contact, litre limits, availability and vehicles (#407), or
            None for the defaults (no contact, no limits, available, both
            vehicles). Validated by the caller.

    Returns:
        The new source, with no activations: it serves no category yet.
    """
    details = details or SupplierDetails()
    source = WaterSource(
        name=name,
        approximate_location=approximate_location,
        is_simulated=is_simulated,
        kind=kind,
        location=_point(location) if location is not None else None,
        contact_name=details.contact_name,
        contact_phone=details.contact_phone,
        min_litres_per_order=details.min_litres_per_order,
        max_litres_per_order=details.max_litres_per_order,
        is_available=details.is_available,
    )
    _apply_vehicle_kinds(source, details.vehicle_kinds)
    session.add(source)
    await session.flush()
    _audit(session, actor=actor, action="water_source_added", source=source)
    await session.commit()
    await session.refresh(source)
    return source


async def set_kind(
    session: AsyncSession, *, actor: User, source_id: uuid.UUID, kind: WaterSourceKind
) -> WaterSource:
    """Set where a source collects water (#21), for Tanker preferences. Commits.

    Args:
        session: Database session.
        actor: The admin making the change.
        source_id: The source.
        kind: Ninth Mile or borehole.

    Returns:
        The source.

    Raises:
        LookupError: No source has this id.
    """
    source = await session.get(WaterSource, source_id, with_for_update=True, populate_existing=True)
    if source is None:
        raise LookupError("no water source has this id")
    source.kind = kind
    _audit(session, actor=actor, action="water_source_kind_set", source=source)
    await session.commit()
    await session.refresh(source)
    return source


async def has_activation(session: AsyncSession, *, water_category_id: uuid.UUID) -> bool:
    """Whether any source is currently ``activated`` for the category (FR-014).

    Approval dates are not checked here; the order-fit check does
    (:func:`app.modules.sources.eligibility.eligible_sources_for`).
    """
    found = await session.scalar(
        select(WaterSourceCategory.id)
        .where(
            WaterSourceCategory.water_category_id == water_category_id,
            WaterSourceCategory.status == ActivationStatus.ACTIVATED,
        )
        .limit(1)
    )
    return found is not None


async def update_source(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    name: str | None = None,
    approximate_location: str | None = None,
    kind: WaterSourceKind | None = None,
    location: SourceLocation | None | _Unset = UNSET,
    changes: dict[str, Any] | None = None,
) -> WaterSource:
    """Edit a source's name, location, kind and #407 details (#309, decision 3). Commits.

    Only the values that differ from the stored ones are written. If none
    differ, nothing is written and no audit row is added. Otherwise one
    ``water_source_updated`` row names the changed fields, never their values
    (audit details keep to ids and kinds; a contact phone is personal data).

    Args:
        session: Database session.
        actor: The admin making the change.
        source_id: The source.
        name: New name, or None to keep it.
        approximate_location: New pickup location in words, or None to keep it.
        kind: New kind, or None to keep it. A kind cannot be cleared here.
        location: The new pickup point, None to clear it, or :data:`UNSET` to
            keep it (#385). The audit row names ``location`` and never the point.
        changes: The #407 fields sent, by name (``contact_name``,
            ``contact_phone``, ``min_litres_per_order``,
            ``max_litres_per_order``, ``is_available``, ``vehicle_kinds``).
            A field left out is kept. Validated by the caller, except the
            minimum-not-above-maximum rule, which needs the stored value.

    Returns:
        The source.

    Raises:
        LookupError: No source has this id.
        LitresRangeError: The minimum would be above the maximum.
    """
    source = await session.get(WaterSource, source_id, with_for_update=True, populate_existing=True)
    if source is None:
        raise LookupError("no water source has this id")
    changed: list[str] = []
    if name is not None and name != source.name:
        source.name = name
        changed.append("name")
    if approximate_location is not None and approximate_location != source.approximate_location:
        source.approximate_location = approximate_location
        changed.append("approximate_location")
    if kind is not None and kind != source.kind:
        source.kind = kind
        changed.append("kind")
    if not isinstance(location, _Unset):
        current = (await source_locations(session, [source_id])).get(source_id)
        if location != current:
            source.location = _point(location) if location is not None else None
            changed.append("location")
    changes = changes or {}
    for field in (
        "contact_name",
        "contact_phone",
        "min_litres_per_order",
        "max_litres_per_order",
        "is_available",
    ):
        if field in changes and changes[field] != getattr(source, field):
            setattr(source, field, changes[field])
            changed.append(field)
    if "vehicle_kinds" in changes and list(changes["vehicle_kinds"]) != source.vehicle_kinds:
        _apply_vehicle_kinds(source, changes["vehicle_kinds"])
        changed.append("vehicle_kinds")
    if (
        source.min_litres_per_order is not None
        and source.max_litres_per_order is not None
        and source.min_litres_per_order > source.max_litres_per_order
    ):
        await session.rollback()
        raise LitresRangeError("min_litres_per_order is above max_litres_per_order")
    if changed:
        _audit(session, actor=actor, action="water_source_updated", source=source, fields=changed)
    await session.commit()
    await session.refresh(source)
    return source


async def list_categories(session: AsyncSession) -> list[WaterCategory]:
    """Return every water category, by label."""
    return list(await session.scalars(select(WaterCategory).order_by(WaterCategory.label)))


async def list_sources(
    session: AsyncSession, *, source_id: uuid.UUID | None = None
) -> list[SourceWithActivations]:
    """Return sources by name, each with its activations by category label.

    Args:
        session: Database session.
        source_id: Only this source (an empty list if it does not exist), or
            None for every source.
    """
    source_filters = [] if source_id is None else [WaterSource.id == source_id]
    sources = list(
        await session.scalars(select(WaterSource).where(*source_filters).order_by(WaterSource.name))
    )
    activation_filters = [] if source_id is None else [WaterSourceCategory.source_id == source_id]
    rows = (
        await session.execute(
            select(WaterSourceCategory, WaterCategory)
            .join(WaterCategory, WaterCategory.id == WaterSourceCategory.water_category_id)
            .where(*activation_filters)
            .order_by(WaterCategory.label)
        )
    ).all()
    by_source: dict[uuid.UUID, list[tuple[WaterSourceCategory, WaterCategory]]] = {}
    for activation, category in rows:
        by_source.setdefault(activation.source_id, []).append((activation, category))
    locations = await source_locations(session, [source.id for source in sources])
    return [
        SourceWithActivations(source, by_source.get(source.id, []), locations.get(source.id))
        for source in sources
    ]


async def activate(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_code: str,
    approved_until: date,
    report_reference: str,
    cost_per_litre_minor_units: int,
) -> WaterSourceCategory:
    """Activate a source for a category, or renew its activation (FR-012). Commits.

    Records the laboratory report reference (the report itself stays outside
    the app, F1), the last approved date and the supplier's cost per litre.
    An existing activation for the pair, in any status, is updated: renewing
    an expired approval and reactivating after a suspension both land here.

    Args:
        session: Database session.
        actor: The admin making the change.
        source_id: The source.
        category_code: ``potable`` or ``utility``.
        approved_until: Last Lagos date the laboratory approval is valid.
        report_reference: Laboratory report reference, e.g. "LR-0001".
        cost_per_litre_minor_units: Supplier's cost per litre in kobo.

    Returns:
        The activation, ``activated``.

    Raises:
        LookupError: Unknown source or category.
        KindRequiredError: The source has no kind (#407, decision 407-2).
            Nothing is written, for a new activation and a renewal alike.
    """
    source, category = await _source_and_category(
        session, source_id, category_code, lock_source=True
    )
    if source.kind is None:
        await session.rollback()
        raise KindRequiredError("set the source's kind before activating it")
    activation = await _activation(session, source.id, category.id)
    if activation is None:
        activation = WaterSourceCategory(source_id=source.id, water_category_id=category.id)
        session.add(activation)
    activation.status = ActivationStatus.ACTIVATED
    activation.status_reason = None
    activation.approved_until = approved_until
    activation.report_reference = report_reference
    activation.cost_per_litre_minor_units = cost_per_litre_minor_units
    _audit(
        session,
        actor=actor,
        action="water_source_activated",
        source=source,
        category=category,
        status=ActivationStatus.ACTIVATED,
    )
    await session.commit()
    await session.refresh(activation)
    return activation


async def set_inactive_status(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_code: str,
    status: ActivationStatus,
    reason: str,
) -> WaterSourceCategory:
    """Suspend or revoke a source's activation for a category (BR-10). Commits.

    From now on the source is not eligible for the category: new
    confirmations cannot choose it and a source review cannot continue with
    it. Orders already confirmed with it keep it; the order detail reports
    the reason (order confirmation contract, decision 10).

    Args:
        session: Database session.
        actor: The admin making the change.
        source_id: The source.
        category_code: ``potable`` or ``utility``.
        status: ``suspended`` or ``revoked``.
        reason: Why, kept on the activation (not in the audit metadata).

    Returns:
        The updated activation.

    Raises:
        ValueError: ``status`` is ``activated`` (use :func:`activate`).
        LookupError: Unknown source or category, or the source has never
            been activated for the category.
    """
    if status is ActivationStatus.ACTIVATED:
        raise ValueError("use activate() to activate a source")
    source, category = await _source_and_category(session, source_id, category_code)
    activation = await _activation(session, source.id, category.id)
    if activation is None:
        raise LookupError(f"the source has no activation for {category.code}")
    activation.status = status
    activation.status_reason = reason
    _audit(
        session,
        actor=actor,
        action=f"water_source_{status.value}",
        source=source,
        category=category,
        status=status,
    )
    await session.commit()
    await session.refresh(activation)
    return activation


async def change_cost(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_code: str,
    cost_per_litre_minor_units: int,
) -> WaterSourceCategory:
    """Change only an activation's cost per litre, in any status (#407). Commits.

    The status, report reference, approval date and reason are not touched,
    so a suspended activation stays suspended. The activation row is locked
    and read fresh, so a suspension saved at the same moment is never undone
    by a stale copy. A cost equal to the stored one writes nothing. Otherwise
    one ``water_source_cost_changed`` audit row names the category, never the
    old or new cost. Only new quotes read the cost (FR-024, T-09).

    Args:
        session: Database session.
        actor: The admin making the change.
        source_id: The source.
        category_code: ``potable`` or ``utility``.
        cost_per_litre_minor_units: The new cost in kobo, ``>= 0``.

    Returns:
        The activation.

    Raises:
        LookupError: Unknown source or category, or the source has never
            been activated for the category.
    """
    source, category = await _source_and_category(session, source_id, category_code)
    activation = await _activation(session, source.id, category.id)
    if activation is None:
        raise LookupError(f"the source has no activation for {category.code}")
    if activation.cost_per_litre_minor_units != cost_per_litre_minor_units:
        activation.cost_per_litre_minor_units = cost_per_litre_minor_units
        _audit(
            session,
            actor=actor,
            action="water_source_cost_changed",
            source=source,
            category=category,
        )
    await session.commit()
    await session.refresh(activation)
    return activation


async def _source_and_category(
    session: AsyncSession, source_id: uuid.UUID, category_code: str, *, lock_source: bool = False
) -> tuple[WaterSource, WaterCategory]:
    source = await session.get(
        WaterSource, source_id, with_for_update=lock_source, populate_existing=lock_source
    )
    if source is None:
        raise LookupError("no water source has this id")
    category = await session.scalar(
        select(WaterCategory).where(WaterCategory.code == category_code)
    )
    if category is None:
        raise LookupError(f"no water category has the code {category_code!r}")
    return source, category


async def _activation(
    session: AsyncSession, source_id: uuid.UUID, category_id: uuid.UUID
) -> WaterSourceCategory | None:
    # Fresh values under the lock: a copy loaded earlier in the session could
    # carry a status another admin has changed since (#407 review).
    return await session.scalar(
        select(WaterSourceCategory)
        .where(
            WaterSourceCategory.source_id == source_id,
            WaterSourceCategory.water_category_id == category_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _audit(
    session: AsyncSession,
    *,
    actor: User,
    action: str,
    source: WaterSource,
    category: WaterCategory | None = None,
    status: ActivationStatus | None = None,
    fields: list[str] | None = None,
) -> None:
    details: dict[str, Any] = {}
    if category is not None:
        details["water_category_id"] = str(category.id)
    if status is not None:
        details["status"] = status.value
    if fields is not None:
        details["fields"] = fields
    audit_service.record(
        session,
        actor_id=actor.id,
        action=action,
        target_type=AUDIT_TARGET_TYPE,
        target_id=source.id,
        details=details,
    )


async def source_usability(session: AsyncSession, *, today: date) -> list[tuple[WaterSource, bool]]:
    """Every water source, by name, and whether it is usable for dispatch today (FR-012).

    A source is usable when at least one of its category activations passes
    :func:`app.modules.sources.eligibility.eligibility_reasons` (active,
    approval not expired in Lagos today). The dashboard counts them; the
    live map lists them.

    Args:
        session: Database session.
        today: Today's date in Africa/Lagos.

    Returns:
        ``(source, usable)`` pairs.
    """
    return [
        (
            item.source,
            any(
                not eligibility_reasons(activation, today=today)
                for activation, _ in item.activations
            ),
        )
        for item in await list_sources(session)
    ]


async def source_names(
    session: AsyncSession, source_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Return each water source's name, for views in other modules.

    Args:
        session: Database session.
        source_ids: Source ids.

    Returns:
        Name by id, for the sources that exist.
    """
    ids = set(source_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(WaterSource.id, WaterSource.name).where(WaterSource.id.in_(ids))
    )
    return {source_id: name for source_id, name in rows}
