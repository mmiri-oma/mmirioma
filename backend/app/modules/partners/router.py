"""Partner account endpoints under ``/driver`` (docs/api/partners.md).

Every endpoint uses ``CurrentDriver``, so customers and admins get 403
``forbidden`` (FR-001); unsafe methods also need the CSRF header, which the
auth dependency enforces. Sign-up (``POST /auth/partner-register``) lives in
the auth router, which owns the session cookie. Handlers only translate
between HTTP and :mod:`app.modules.partners.service` and
:mod:`app.modules.notifications.service`.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentDriver
from app.modules.notifications import service as notifications_service
from app.modules.notifications.schemas import (
    MarkReadRequest,
    NotificationPageRead,
    NotificationRead,
)
from app.modules.orders.schemas import PageParams
from app.modules.partners import location as driver_location
from app.modules.partners import service
from app.modules.partners.location_schemas import (
    DriverLocationRead,
    DriverLocationUpdate,
    SharingGrantRead,
)
from app.modules.partners.schemas import (
    AvailabilityUpdate,
    PartnerProfileRead,
    PartnerProfileUpdate,
    PreferencesRead,
    ZoneRead,
    partner_vehicle_read,
)
from app.shared.lagos_time import LAGOS_TZ

router = APIRouter(prefix="/driver", tags=["partner account"])

DbSession = Annotated[AsyncSession, Depends(get_db_session)]

_AUTH_ERRORS: dict[int | str, dict[str, object]] = {
    HTTPStatus.UNAUTHORIZED: {"model": ErrorResponse},
    HTTPStatus.FORBIDDEN: {"model": ErrorResponse},
}
_PROFILE_ERRORS: dict[int | str, dict[str, object]] = {
    **_AUTH_ERRORS,
    HTTPStatus.NOT_FOUND: {"model": ErrorResponse},
}


def profile_read(partner: service.PartnerProfile) -> PartnerProfileRead:
    """Build ``PartnerProfileRead`` from the service's view.

    Args:
        partner: The partner's account, profile, verified vehicle and zones.

    Returns:
        The response body.
    """
    profile = partner.profile
    return PartnerProfileRead(
        location=partner.location,
        id=partner.user.id,
        name=partner.user.name,
        phone=partner.user.phone,
        phone_verified=partner.user.phone_verified_at is not None,
        approval_status=profile.approval_status,
        is_available=profile.is_available,
        # The day the account was created, in Lagos (SRS §2.1).
        partner_since=partner.user.created_at.astimezone(LAGOS_TZ).date(),
        vehicle=partner_vehicle_read(profile, partner.vehicle),
        service_zones=[ZoneRead(id=zone.id, name=zone.name) for zone in partner.zones],
        preferences=PreferencesRead(
            new_order_alerts=profile.new_order_alerts, sms_updates=profile.sms_updates
        ),
    )


@router.get("/profile", responses=_PROFILE_ERRORS)
async def get_profile(driver: CurrentDriver, db: DbSession) -> PartnerProfileRead:
    """The signed-in partner's own profile.

    Raises:
        APIError: 404 ``no_driver_profile``.
    """
    return profile_read(await service.get_profile(db, driver))


@router.patch("/profile", responses=_PROFILE_ERRORS)
async def update_profile(
    body: PartnerProfileUpdate, driver: CurrentDriver, db: DbSession
) -> PartnerProfileRead:
    """Change the partner's preferences; every other field is admin-managed.

    Raises:
        APIError: 404 ``no_driver_profile``.
    """
    preferences = body.preferences
    partner = await service.update_preferences(
        db,
        driver,
        new_order_alerts=preferences.new_order_alerts if preferences else None,
        sms_updates=preferences.sms_updates if preferences else None,
    )
    return profile_read(partner)


@router.put("/availability", responses=_PROFILE_ERRORS)
async def set_availability(
    body: AvailabilityUpdate, driver: CurrentDriver, db: DbSession
) -> PartnerProfileRead:
    """Go online or offline (FR-031).

    Raises:
        APIError: 403 ``partner_not_approved``; 404 ``no_driver_profile``.
    """
    partner = await service.set_availability(db, driver, available=body.is_available)
    return profile_read(partner)


@router.get("/notifications", responses=_AUTH_ERRORS)
async def list_notifications(
    page: Annotated[PageParams, Query()], driver: CurrentDriver, db: DbSession
) -> NotificationPageRead:
    """The partner's in-app messages, newest first (FR-050)."""
    result = await notifications_service.list_for_user(
        db, user_id=driver.id, limit=page.limit, offset=page.offset
    )
    return NotificationPageRead(
        items=[
            NotificationRead(
                id=view.notification.id,
                kind=view.notification.kind,
                title=view.notification.title,
                body=view.notification.body,
                reference=view.order_reference,
                created_at=view.notification.created_at,
                read_at=view.notification.read_at,
            )
            for view in result.items
        ],
        unread_count=result.unread_count,
        total=result.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post("/notifications/read", status_code=HTTPStatus.NO_CONTENT, responses=_AUTH_ERRORS)
async def mark_notifications_read(
    driver: CurrentDriver,
    db: DbSession,
    body: Annotated[MarkReadRequest | None, Body()] = None,
) -> Response:
    """Mark the given messages read, or every unread one with no ``ids``."""
    await notifications_service.mark_read(
        db, user_id=driver.id, ids=body.ids if body is not None else None
    )
    return Response(status_code=HTTPStatus.NO_CONTENT)


_LOCATION_ERRORS = {
    **_PROFILE_ERRORS,
    HTTPStatus.CONFLICT: {"model": ErrorResponse},
    HTTPStatus.UNPROCESSABLE_ENTITY: {"model": ErrorResponse},
}


@router.post("/location/sharing", responses=_LOCATION_ERRORS)
async def enable_location_sharing(driver: CurrentDriver, db: DbSession) -> SharingGrantRead:
    """Issue a grant after explicit location consent (FR-035, #410)."""
    return SharingGrantRead(grant=await driver_location.grant_sharing(db, driver))


@router.put("/location", responses=_LOCATION_ERRORS)
async def confirm_driver_location(
    body: DriverLocationUpdate, driver: CurrentDriver, db: DbSession
) -> DriverLocationRead:
    """Confirm one current device point; never return coordinates (FR-031)."""
    return await driver_location.confirm_location(db, driver, body)


@router.delete("/location", status_code=HTTPStatus.NO_CONTENT, responses=_AUTH_ERRORS)
async def delete_driver_location(driver: CurrentDriver, db: DbSession) -> Response:
    """Withdraw sharing and invalidate outstanding writes, retaining availability."""
    await driver_location.withdraw_sharing(db, driver)
    return Response(status_code=HTTPStatus.NO_CONTENT)
