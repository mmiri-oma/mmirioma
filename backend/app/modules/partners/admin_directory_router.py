"""Admin driver directory endpoints (docs/api/admin-directory.md, "Drivers").

Every endpoint uses ``CurrentAdmin``, so customers and drivers get 403
``forbidden`` (FR-001); the two ``POST`` endpoints also need the CSRF header,
which the auth dependency enforces. Handlers only translate between HTTP and
:mod:`app.modules.partners.directory`. There is no create endpoint: partners
sign themselves up (``POST /auth/partner-register``) and staff-created
accounts are not in the MVP (decided 2026-10-26).
"""

import uuid
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentAdmin
from app.modules.partners import directory
from app.modules.partners.admin_directory_schemas import (
    ActivationChange,
    AdminDriverCountsRead,
    AdminDriverListParams,
    AdminDriverPageRead,
    AdminDriverRead,
    ApprovalChange,
)
from app.modules.partners.schemas import ZoneRead, partner_vehicle_read

router = APIRouter(prefix="/admin/drivers", tags=["admin drivers"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

_AUTH_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
}
_NOT_FOUND: dict[int | str, dict[str, object]] = {
    **_AUTH_ERRORS,
    HTTPStatus.NOT_FOUND: {"model": ErrorResponse},
}
_CHANGE_ERRORS: dict[int | str, dict[str, object]] = {
    **_NOT_FOUND,
    HTTPStatus.CONFLICT: {"model": ErrorResponse},
}


def driver_read(row: directory.DriverRow) -> AdminDriverRead:
    """Build the admin driver object from the service's view.

    Args:
        row: The driver's account, profile, verified vehicle, zones and counts.

    Returns:
        The response body.
    """
    return AdminDriverRead(
        id=row.user.id,
        name=row.user.name,
        phone=row.user.phone,
        phone_verified=row.user.phone_verified_at is not None,
        is_active=row.user.is_active,
        approval_status=row.profile.approval_status,
        is_available=row.profile.is_available,
        vehicle=partner_vehicle_read(row.profile, row.vehicle),
        zones=[ZoneRead(id=zone.id, name=zone.name) for zone in row.zones],
        live_jobs=row.live_jobs,
        completed_jobs=row.completed_jobs,
        delivered_jobs=row.delivered_jobs,
        created_at=row.user.created_at,
    )


@router.get("", responses=_AUTH_ERRORS)
async def list_drivers(
    params: Annotated[AdminDriverListParams, Query()], admin: CurrentAdmin, db: DbSession
) -> AdminDriverPageRead:
    """List drivers by name, with the counts for the pills over every driver."""
    page = await directory.list_drivers(
        db,
        delivery_type=params.delivery_type,
        approval_status=params.approval_status,
        is_active=params.is_active,
        q=params.q,
        limit=params.limit,
        offset=params.offset,
    )
    return AdminDriverPageRead(
        items=[driver_read(row) for row in page.rows],
        total=page.total,
        limit=params.limit,
        offset=params.offset,
        counts=AdminDriverCountsRead(**vars(page.counts)),
    )


@router.get("/{driver_id}", responses=_NOT_FOUND)
async def get_driver(driver_id: uuid.UUID, admin: CurrentAdmin, db: DbSession) -> AdminDriverRead:
    """Return one driver. 404 ``driver_not_found`` for an id that is not a driver."""
    return driver_read(await directory.get_driver(db, driver_id))


@router.post("/{driver_id}/approval", responses=_CHANGE_ERRORS)
async def change_approval(
    driver_id: uuid.UUID, body: ApprovalChange, admin: CurrentAdmin, db: DbSession
) -> AdminDriverRead:
    """Approve or suspend a partner; approving records the verified vehicle (FR-013).

    Raises:
        APIError: 404 ``driver_not_found``; 409 ``driver_inactive``,
            ``partner_phone_not_verified`` or ``driver_has_accepted_job``;
            422 ``validation_error``.
    """
    vehicle = (
        None
        if body.vehicle is None
        else directory.VehicleInput(
            description=body.vehicle.description,
            safe_payload_litres=body.vehicle.safe_payload_litres,
            transfer_methods=[method.value for method in body.vehicle.transfer_methods],
        )
    )
    row = await directory.set_approval(
        db,
        admin=admin,
        driver_id=driver_id,
        approval_status=body.approval_status,
        reason=body.reason,
        vehicle=vehicle,
    )
    return driver_read(row)


@router.post("/{driver_id}/activation", responses=_CHANGE_ERRORS)
async def change_activation(
    driver_id: uuid.UUID, body: ActivationChange, admin: CurrentAdmin, db: DbSession
) -> AdminDriverRead:
    """Activate or deactivate a partner's account (FR-002).

    Raises:
        APIError: 404 ``driver_not_found``; 409 ``driver_has_accepted_job``;
            422 ``validation_error``.
    """
    row = await directory.set_activation(
        db, admin=admin, driver_id=driver_id, is_active=body.is_active, reason=body.reason
    )
    return driver_read(row)
