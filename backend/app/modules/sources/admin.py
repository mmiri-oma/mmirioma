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
) -> SourceWithActivations:
    """Add a source (audit ``water_source_added``). It serves no category yet."""
    source = await service.add_source(
        session,
        actor=actor,
        name=name,
        approximate_location=approximate_location,
        is_simulated=is_simulated,
        kind=kind,
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
) -> SourceWithActivations:
    """Edit a source's name, location and kind.

    Raises:
        APIError: 404 ``water_source_not_found``.
    """
    try:
        await service.update_source(
            session,
            actor=actor,
            source_id=source_id,
            name=name,
            approximate_location=approximate_location,
            kind=kind,
        )
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
        APIError: 404 ``water_source_not_found`` or ``water_category_not_found``.
    """
    await _require_source(session, source_id)
    category = await _require_category(session, category_id)
    await service.activate(
        session,
        actor=actor,
        source_id=source_id,
        category_code=category.code,
        approved_until=approved_until,
        report_reference=report_reference,
        cost_per_litre_minor_units=cost_per_litre_minor_units,
    )
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
        raise APIError(
            HTTPStatus.NOT_FOUND,
            "activation_not_found",
            "This source has not been activated for this category",
        ) from None
    return await _view(session, source_id)
