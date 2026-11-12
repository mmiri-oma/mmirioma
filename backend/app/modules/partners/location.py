"""Current driver point and revocable sharing grants (#410, FR-031/FR-035).

Every write and clearing path holds the driver-profile lock. Grants prevent
late HTTP writes from restoring a location after consent has been withdrawn.
No coordinates are returned or written to audits or notifications.
"""

import math
import uuid
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Literal

from geoalchemy2 import WKTElement
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.auth.models import User
from app.modules.dispatch.models import ApprovalStatus, DriverProfile
from app.modules.partners.location_schemas import DriverLocationRead, DriverLocationUpdate
from app.modules.partners.models import DriverLocation


def freshness(confirmed_at: datetime | None, *, now: datetime) -> Literal["fresh", "stale", "none"]:
    """Decide freshness with an injected clock; exactly the threshold is stale."""
    if confirmed_at is None:
        return "none"
    until = confirmed_at + timedelta(seconds=get_settings().driver_location_freshness_seconds)
    return "fresh" if now < until else "stale"


async def lock_profile(session: AsyncSession, driver_id: uuid.UUID) -> DriverProfile | None:
    """Lock and refresh a profile before eligibility changes or location writes.

    Refresh matters when authentication or another service loaded an older row
    before this transaction waited for a concurrent clearing path.
    """
    return await session.scalar(
        select(DriverProfile)
        .where(DriverProfile.user_id == driver_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def clear_locked(session: AsyncSession, profile: DriverProfile) -> int:
    """Invalidate sharing and delete the point under the caller's profile lock.

    Does not commit. Returns the number of points deleted, for privacy audits.
    """
    profile.location_sharing_on = False
    profile.location_sharing_grant += 1
    removed = await session.scalar(
        delete(DriverLocation)
        .where(DriverLocation.driver_id == profile.user_id)
        .returning(DriverLocation.driver_id)
    )
    return int(removed is not None)


async def clear_for_driver(session: AsyncSession, driver_id: uuid.UUID) -> int:
    """Lock and clear within the caller's transaction, including CLI/privacy paths."""
    profile = await lock_profile(session, driver_id)
    return await clear_locked(session, profile) if profile is not None else 0


async def read_location(
    session: AsyncSession, profile: DriverProfile, *, now: datetime
) -> DriverLocationRead:
    """Read only age, accuracy and sharing; never serialize coordinates or grant."""
    row = (
        await session.execute(
            select(DriverLocation.confirmed_at, DriverLocation.accuracy_metres).where(
                DriverLocation.driver_id == profile.user_id
            )
        )
    ).one_or_none()
    if row is None:
        return DriverLocationRead(sharing=profile.location_sharing_on)
    confirmed_at, accuracy = row
    return DriverLocationRead(
        state=freshness(confirmed_at, now=now),
        sharing=profile.location_sharing_on,
        confirmed_at=confirmed_at,
        fresh_until=confirmed_at
        + timedelta(seconds=get_settings().driver_location_freshness_seconds),
        accuracy_metres=accuracy,
    )


async def _eligible(session: AsyncSession, user: User) -> DriverProfile:
    profile = await lock_profile(session, user.id)
    # Re-read after the profile lock: authentication may predate deactivation.
    active = await session.scalar(select(User.is_active).where(User.id == user.id))
    if not active:
        raise APIError(HTTPStatus.UNAUTHORIZED, "not_authenticated", "Sign in to continue")
    if profile is None:
        raise APIError(
            HTTPStatus.NOT_FOUND,
            "no_driver_profile",
            "Your partner details are not set up yet. Contact MmiriOma.",
        )
    if profile.approval_status is not ApprovalStatus.APPROVED:
        raise APIError(
            HTTPStatus.FORBIDDEN, "partner_not_approved", "Your account is not approved for work."
        )
    if not profile.is_available:
        raise APIError(
            HTTPStatus.CONFLICT, "driver_offline", "Go online before sharing your location."
        )
    return profile


async def grant_sharing(session: AsyncSession, user: User) -> int:
    """Issue a new consent grant to an active, approved, online driver and commit."""
    profile = await _eligible(session, user)
    profile.location_sharing_grant += 1
    profile.location_sharing_on = True
    grant = profile.location_sharing_grant
    await session.commit()
    return grant


async def confirm_location(
    session: AsyncSession, user: User, body: DriverLocationUpdate
) -> DriverLocationRead:
    """Replace the one current point only under its current sharing grant.

    Raises:
        APIError: Authentication/eligibility errors or 409
            ``location_sharing_withdrawn`` for a revoked or superseded grant.
    """
    profile = await _eligible(session, user)
    if not profile.location_sharing_on or body.grant != profile.location_sharing_grant:
        raise APIError(
            HTTPStatus.CONFLICT,
            "location_sharing_withdrawn",
            "Location sharing was withdrawn. Confirm your consent again.",
        )
    now = datetime.now(UTC)
    row = await session.get(DriverLocation, user.id, populate_existing=True)
    if row is None:
        row = DriverLocation(driver_id=user.id)
        session.add(row)
    row.location = WKTElement(
        f"POINT({body.location.longitude!r} {body.location.latitude!r})", srid=4326
    )
    row.accuracy_metres = math.ceil(body.accuracy_metres)
    row.confirmed_at = now
    result = DriverLocationRead(
        state="fresh",
        sharing=True,
        confirmed_at=now,
        fresh_until=now + timedelta(seconds=get_settings().driver_location_freshness_seconds),
        accuracy_metres=row.accuracy_metres,
    )
    await session.commit()
    return result


async def withdraw_sharing(session: AsyncSession, user: User) -> None:
    """Revoke sharing and delete the current point while leaving availability unchanged."""
    await clear_for_driver(session, user.id)
    await session.commit()
