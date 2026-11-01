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
    ActivationStatusWrite,
    ActivationWrite,
    WaterSourceCreate,
    WaterSourceListRead,
    WaterSourceRead,
    WaterSourceUpdate,
    category_read,
    source_read,
)
from app.modules.sources.models import ActivationStatus
from app.modules.sources.service import SourceWithActivations
from app.shared.lagos_time import lagos_today

router = APIRouter(prefix="/admin/water-sources", tags=["admin water sources"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

_AUTH_ERRORS = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
}
_NOT_FOUND = {HTTPStatus.NOT_FOUND: {"model": ErrorResponse}}


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
        )
    )


@router.patch("/{source_id}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
async def edit_water_source(
    source_id: uuid.UUID, body: WaterSourceUpdate, admin_user: CurrentAdmin, db: DbSession
) -> WaterSourceRead:
    """Edit the name, location or kind. A save that changes nothing writes nothing."""
    return _read(
        await admin.update(
            db,
            actor=admin_user,
            source_id=source_id,
            name=body.name,
            approximate_location=body.approximate_location,
            kind=body.kind,
        )
    )


@router.put("/{source_id}/activations/{category_id}", responses={**_AUTH_ERRORS, **_NOT_FOUND})
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
