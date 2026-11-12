"""Admin water-source endpoints (#309, docs/api/admin-water-sources.md).

``CurrentAdmin`` only, so customers and drivers get 403 ``forbidden`` and the
supplier's cost per litre, which these bodies carry, reaches no one else.
Unsafe methods need the CSRF header like every other write.
"""

import uuid
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentAdmin
from app.modules.sources import admin
from app.modules.sources.admin_schemas import (
    ActivationCostWrite,
    ActivationStatusWrite,
    ActivationWrite,
    SourceLocationBody,
    WaterSourceCreate,
    WaterSourceListRead,
    WaterSourceRead,
    WaterSourceUpdate,
    category_read,
    source_read,
)
from app.modules.sources.models import ActivationStatus
from app.modules.sources.service import (
    UNSET,
    SourceLocation,
    SourceWithActivations,
    SupplierDetails,
)
from app.shared.lagos_time import lagos_today

router = APIRouter(prefix="/admin/water-sources", tags=["admin water sources"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _location(body: SourceLocationBody | None) -> SourceLocation | None:
    """The service's pickup point for a request's ``location`` (None clears or omits it)."""
    return SourceLocation(body.latitude, body.longitude) if body is not None else None


_AUTH_ERRORS = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
}
_NOT_FOUND = {HTTPStatus.NOT_FOUND: {"model": ErrorResponse}}
_CONFLICT = {HTTPStatus.CONFLICT: {"model": ErrorResponse}}


def _read(view: SourceWithActivations) -> WaterSourceRead:
    return source_read(view, today=lagos_today())


@router.get("", responses=_AUTH_ERRORS)
async def list_water_sources(admin_user: CurrentAdmin, db: DbSession) -> WaterSourceListRead:
    """Every source by name with its activations, and both water categories."""
    today = lagos_today()
    views, categories = await admin.list_all(db)
    return WaterSourceListRead(
        items=[source_read(view, today=today) for view in views],
        categories=[category_read(category) for category in categories],
    )


@router.post("", status_code=HTTPStatus.CREATED, responses=_AUTH_ERRORS)
async def add_water_source(
    body: WaterSourceCreate, admin_user: CurrentAdmin, db: DbSession
) -> WaterSourceRead:
    """Add a source. It serves no category until it is activated."""
    return _read(
        await admin.create(
            db,
            actor=admin_user,
            name=body.name,
            approximate_location=body.approximate_location,
            kind=body.kind,
            is_simulated=body.is_simulated,
            location=_location(body.location),
            details=SupplierDetails(
                contact_name=body.contact_name,
                contact_phone=body.contact_phone,
                min_litres_per_order=body.min_litres_per_order,
                max_litres_per_order=body.max_litres_per_order,
                is_available=body.is_available,
                vehicle_kinds=tuple(body.vehicle_kinds),
            ),
        )
    )


@router.patch("/{source_id}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
async def edit_water_source(
    source_id: uuid.UUID, body: WaterSourceUpdate, admin_user: CurrentAdmin, db: DbSession
) -> WaterSourceRead:
    """Edit any field of a source. A save that changes nothing writes nothing."""
    return _read(
        await admin.update(
            db,
            actor=admin_user,
            source_id=source_id,
            name=body.name,
            approximate_location=body.approximate_location,
            kind=body.kind,
            location=_location(body.location) if "location" in body.model_fields_set else UNSET,
            changes=body.supplier_changes(),
        )
    )


@router.put(
    "/{source_id}/activations/{category_id}",
    responses={**_AUTH_ERRORS, **_NOT_FOUND, **_CONFLICT},
)
async def activate_water_source(
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    body: ActivationWrite,
    admin_user: CurrentAdmin,
    db: DbSession,
) -> WaterSourceRead:
    """Activate a source for a category, or renew it in any status (FR-012)."""
    return _read(
        await admin.activate(
            db,
            actor=admin_user,
            source_id=source_id,
            category_id=category_id,
            approved_until=body.approved_until,
            report_reference=body.report_reference,
            cost_per_litre_minor_units=body.cost_per_litre_minor_units,
        )
    )


@router.patch("/{source_id}/activations/{category_id}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
async def change_activation_cost(
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    body: ActivationCostWrite,
    admin_user: CurrentAdmin,
    db: DbSession,
) -> WaterSourceRead:
    """Change only the cost per litre (#407). New quotes use it; nothing else changes."""
    return _read(
        await admin.change_cost(
            db,
            actor=admin_user,
            source_id=source_id,
            category_id=category_id,
            cost_per_litre_minor_units=body.cost_per_litre_minor_units,
        )
    )


@router.post(
    "/{source_id}/activations/{category_id}/status", responses={**_AUTH_ERRORS, **_NOT_FOUND}
)
async def set_activation_status(
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    body: ActivationStatusWrite,
    admin_user: CurrentAdmin,
    db: DbSession,
) -> WaterSourceRead:
    """Suspend or revoke an activation with a reason (BR-10)."""
    return _read(
        await admin.set_status(
            db,
            actor=admin_user,
            source_id=source_id,
            category_id=category_id,
            status=ActivationStatus(body.status),
            reason=body.reason,
        )
    )
