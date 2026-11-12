"""Partner accounts: sign-up, profile, availability (docs/api/partners.md).

Rules implemented here:

- **Sign-up** (``POST /auth/partner-register``) creates a ``driver`` account
  and its driver profile in one transaction: ``pending``, unavailable, with
  the vehicle the partner declared and their zone as the first
  ``driver_service_zones`` row. The zone must be active (FR-010). Nothing is
  verified yet: no vehicle profile is linked until an admin approves (FR-013;
  partners.md, decision 8).
- **Going online** needs ``approval_status = approved``
  (partners.md, "Approval status"); the account is active, or its session
  would not exist (FR-002). Going offline is always allowed and never
  touches a job the partner holds.
- **Preferences** are stored only (decision 5).
- Sign-up and every availability change are audited (NFR-004). The contract
  also asks for a notice to admins that a partner is waiting; there is no
  admin notification store yet, so only the audit row records it.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http import HTTPStatus

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.audit import service as audit_service
from app.modules.auth import security
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.dispatch.models import (
    ApprovalStatus,
    DeliveryType,
    DriverProfile,
    DriverServiceZone,
    VehicleProfile,
)
from app.modules.notifications import admin_messages
from app.modules.partners import location as driver_location
from app.modules.partners.location_schemas import DriverLocationRead
from app.modules.pricing.models import ServiceZone


@dataclass(frozen=True)
class PartnerProfile:
    """Everything ``PartnerProfileRead`` is built from.

    Attributes:
        user: The partner's account.
        profile: Their driver profile.
        vehicle: The verified vehicle, or None until an admin links one.
        zones: The zones they work in, sign-up zone first.
        location: Current location age/sharing, with no coordinates (#410).
    """

    user: User
    profile: DriverProfile
    vehicle: VehicleProfile | None
    zones: list[ServiceZone]
    location: DriverLocationRead = field(default_factory=DriverLocationRead)


def _no_driver_profile() -> APIError:
    # A driver created with the command-line tool may have no profile yet;
    # the code is the one dispatch already uses (docs/api/deliveries.md).
    return APIError(
        HTTPStatus.NOT_FOUND,
        "no_driver_profile",
        "Your partner details are not set up yet. Contact MmiriOma.",
    )


def _zone_error() -> APIError:
    return APIError(
        HTTPStatus.UNPROCESSABLE_ENTITY,
        "validation_error",
        "Request validation failed",
        details=[
            {
                "loc": ["body", "service_zone_id"],
                "msg": "Choose an area we deliver in",
                "type": "value_error",
            }
        ],
    )


async def register_partner(
    session: AsyncSession,
    *,
    name: str,
    phone: str,
    password: str,
    delivery_type: DeliveryType,
    plate: str,
    declared_capacity_gallons: int | None,
    service_zone_id: uuid.UUID,
) -> User:
    """Create a pending partner account and profile, and commit.

    Args:
        session: Database session; committed or rolled back here.
        name: Display name (validated).
        phone: Normalized E.164 phone.
        password: Plain-text password; only its hash is stored.
        delivery_type: Keke or tanker.
        plate: Normalized plate.
        declared_capacity_gallons: Tanker capacity the partner typed; None
            for a keke (validated by the schema).
        service_zone_id: The zone chosen at sign-up.

    Returns:
        The new ``driver`` account, ``phone_verified`` false.

    Raises:
        APIError: 422 ``validation_error`` (``service_zone_id``) for an
            unknown or inactive zone; 409 ``phone_already_registered``.
    """
    zone = await session.get(ServiceZone, service_zone_id)
    if zone is None or not zone.is_active:
        raise _zone_error()
    password_hash = await asyncio.to_thread(security.hash_password, password)
    user = User(name=name, phone=phone, password_hash=password_hash, role=UserRole.DRIVER)
    # Partners only come through sign-up, whose schema requires the acceptance.
    auth_service.record_terms_acceptance(user)
    session.add(user)
    try:
        # The unique phone constraint decides, so two concurrent sign-ups
        # cannot both succeed.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "phone_already_registered",
            "An account with this phone number already exists",
        ) from exc
    profile = DriverProfile(
        user_id=user.id,
        approval_status=ApprovalStatus.PENDING,
        is_available=False,
        delivery_type=delivery_type,
        plate=plate,
        declared_capacity_gallons=declared_capacity_gallons,
    )
    session.add(profile)
    await session.flush()
    session.add(DriverServiceZone(driver_profile_id=profile.id, zone_id=zone.id))
    audit_service.record(
        session,
        actor_id=user.id,
        action="partner_registered",
        target_type="user",
        target_id=user.id,
        details={"delivery_type": delivery_type.value, "zone_id": str(zone.id)},
    )
    # "A notice for admin that a partner is waiting" (partners.md), in the
    # same transaction (admin-operations.md, "Notifications (admin)").
    await admin_messages.partner_pending(session)
    await session.commit()
    return user


async def _profile_of(session: AsyncSession, user: User, *, lock: bool = False) -> DriverProfile:
    statement = select(DriverProfile).where(DriverProfile.user_id == user.id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    profile = await session.scalar(statement)
    if profile is None:
        raise _no_driver_profile()
    return profile


async def _load(session: AsyncSession, user: User, profile: DriverProfile) -> PartnerProfile:
    vehicle = (
        await session.get(VehicleProfile, profile.vehicle_profile_id)
        if profile.vehicle_profile_id is not None
        else None
    )
    zones = list(
        await session.scalars(
            select(ServiceZone)
            .join(DriverServiceZone, DriverServiceZone.zone_id == ServiceZone.id)
            .where(DriverServiceZone.driver_profile_id == profile.id)
            # The sign-up zone is the first row.
            .order_by(DriverServiceZone.created_at, DriverServiceZone.id)
        )
    )
    location = await driver_location.read_location(session, profile, now=datetime.now(UTC))
    return PartnerProfile(
        user=user, profile=profile, vehicle=vehicle, zones=zones, location=location
    )


async def get_profile(session: AsyncSession, user: User) -> PartnerProfile:
    """Return the signed-in partner's profile.

    Raises:
        APIError: 404 ``no_driver_profile``.
    """
    return await _load(session, user, await _profile_of(session, user))


async def update_preferences(
    session: AsyncSession,
    user: User,
    *,
    new_order_alerts: bool | None,
    sms_updates: bool | None,
) -> PartnerProfile:
    """Change the given preferences and commit; None leaves one unchanged.

    Raises:
        APIError: 404 ``no_driver_profile``.
    """
    profile = await _profile_of(session, user, lock=True)
    if new_order_alerts is not None:
        profile.new_order_alerts = new_order_alerts
    if sms_updates is not None:
        profile.sms_updates = sms_updates
    await session.commit()
    await session.refresh(profile)
    return await _load(session, user, profile)


async def set_availability(session: AsyncSession, user: User, *, available: bool) -> PartnerProfile:
    """Go online or offline (FR-031 availability) and commit.

    Repeating a value writes no availability audit row. Offline requests
    always invalidate location grants and delete the point (#410).

    Raises:
        APIError: 404 ``no_driver_profile``; 403 ``partner_not_approved``
            when going online while ``pending`` or ``suspended``.
    """
    profile = await _profile_of(session, user, lock=True)
    if available and profile.approval_status is not ApprovalStatus.APPROVED:
        await session.rollback()
        raise APIError(
            HTTPStatus.FORBIDDEN,
            "partner_not_approved",
            "Your account is waiting for approval. You can take orders once admin "
            "approves your vehicle.",
        )
    if not available:
        await driver_location.clear_locked(session, profile)
    if profile.is_available != available:
        profile.is_available = available
        audit_service.record(
            session,
            actor_id=user.id,
            action="driver_went_online" if available else "driver_went_offline",
            target_type="user",
            target_id=user.id,
        )
    await session.commit()
    await session.refresh(profile)
    return await _load(session, user, profile)
