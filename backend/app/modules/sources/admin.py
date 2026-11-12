"""What the admin water-source endpoints do (#309, docs/api/admin-water-sources.md).

A thin layer over :mod:`app.modules.sources.service`: it looks the source and
category up by id, turns a missing one into a 404, runs the same service
function the command line uses (so the audit row is the same), and returns
the whole source so the screen can replace one row.

Every function commits through the service function it calls.
"""

import uuid
from datetime import date
from http import HTTPStatus
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.auth.models import User
from app.modules.sources import service
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceKind,
)
from app.modules.sources.service import SourceWithActivations


def _source_not_found() -> APIError:
    return APIError(HTTPStatus.NOT_FOUND, "water_source_not_found", "Water source not found")


def _category_not_found() -> APIError:
    return APIError(HTTPStatus.NOT_FOUND, "water_category_not_found", "Water category not found")


async def _require_source(session: AsyncSession, source_id: uuid.UUID) -> WaterSource:
    source = await session.get(WaterSource, source_id)
    if source is None:
        raise _source_not_found()
    return source


def _activation_not_found() -> APIError:
    return APIError(
        HTTPStatus.NOT_FOUND,
        "activation_not_found",
        "This source has not been activated for this category",
    )


async def _require_category(session: AsyncSession, category_id: uuid.UUID) -> WaterCategory:
    category = await session.get(WaterCategory, category_id)
    if category is None:
        raise _category_not_found()
    return category


async def _view(session: AsyncSession, source_id: uuid.UUID) -> SourceWithActivations:
    views = await service.list_sources(session, source_id=source_id)
    if not views:
        raise _source_not_found()
    return views[0]


async def list_all(
    session: AsyncSession,
) -> tuple[list[SourceWithActivations], list[WaterCategory]]:
    """Every source with its activations, and both water categories.

    Args:
        session: Database session.

    Returns:
        The sources by name, and the categories by label.
    """
    return await service.list_sources(session), await service.list_categories(session)


async def create(
    session: AsyncSession,
    *,
    actor: User,
    name: str,
    approximate_location: str,
    kind: WaterSourceKind | None,
    is_simulated: bool,
    location: service.SourceLocation | None = None,
    details: service.SupplierDetails | None = None,
) -> SourceWithActivations:
    """Add a source (audit ``water_source_added``). It serves no category yet."""
    source = await service.add_source(
        session,
        actor=actor,
        name=name,
        approximate_location=approximate_location,
        is_simulated=is_simulated,
        kind=kind,
        location=location,
        details=details,
    )
    return await _view(session, source.id)


async def update(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    name: str | None,
    approximate_location: str | None,
    kind: WaterSourceKind | None,
    location: service.SourceLocation | None | service._Unset = service.UNSET,
    changes: dict[str, Any] | None = None,
) -> SourceWithActivations:
    """Edit a source's name, location, kind and #407 details.

    Raises:
        APIError: 404 ``water_source_not_found``; 422 ``validation_error`` on
            ``max_litres_per_order`` when the edit would leave the stored
            minimum above the maximum.
    """
    try:
        await service.update_source(
            session,
            actor=actor,
            source_id=source_id,
            name=name,
            approximate_location=approximate_location,
            kind=kind,
            location=location,
            changes=changes,
        )
    except service.LitresRangeError:
        raise APIError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "validation_error",
            "Request validation failed",
            details=[
                {
                    "loc": ["body", "max_litres_per_order"],
                    "msg": "The largest order cannot be smaller than the smallest",
                    "type": "value_error",
                }
            ],
        ) from None
    except LookupError:
        raise _source_not_found() from None
    return await _view(session, source_id)


async def activate(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    approved_until: date,
    report_reference: str,
    cost_per_litre_minor_units: int,
) -> SourceWithActivations:
    """Activate a source for a category, or renew it, in any status (FR-012).

    Raises:
        APIError: 404 ``water_source_not_found`` or ``water_category_not_found``;
            409 ``water_source_kind_required`` when the source has no kind
            (#407): nothing is written.
    """
    await _require_source(session, source_id)
    category = await _require_category(session, category_id)
    try:
        await service.activate(
            session,
            actor=actor,
            source_id=source_id,
            category_code=category.code,
            approved_until=approved_until,
            report_reference=report_reference,
            cost_per_litre_minor_units=cost_per_litre_minor_units,
        )
    except service.KindRequiredError:
        raise APIError(
            HTTPStatus.CONFLICT,
            "water_source_kind_required",
            "Set where this source collects water before activating it.",
        ) from None
    return await _view(session, source_id)


async def change_cost(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    cost_per_litre_minor_units: int,
) -> SourceWithActivations:
    """Change only an activation's cost per litre (#407); new quotes only.

    Raises:
        APIError: 404 ``water_source_not_found``, ``water_category_not_found``
            or ``activation_not_found``, in that order.
    """
    await _require_source(session, source_id)
    category = await _require_category(session, category_id)
    try:
        await service.change_cost(
            session,
            actor=actor,
            source_id=source_id,
            category_code=category.code,
            cost_per_litre_minor_units=cost_per_litre_minor_units,
        )
    except LookupError:
        raise _activation_not_found() from None
    return await _view(session, source_id)


async def set_status(
    session: AsyncSession,
    *,
    actor: User,
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    status: ActivationStatus,
    reason: str,
) -> SourceWithActivations:
    """Suspend or revoke an activation (BR-10).

    Raises:
        APIError: 404 ``water_source_not_found``, ``water_category_not_found``
            or ``activation_not_found`` (never activated for this category).
    """
    await _require_source(session, source_id)
    category = await _require_category(session, category_id)
    try:
        await service.set_inactive_status(
            session,
            actor=actor,
            source_id=source_id,
            category_code=category.code,
            status=status,
            reason=reason,
        )
    except LookupError:
        raise _activation_not_found() from None
    return await _view(session, source_id)
