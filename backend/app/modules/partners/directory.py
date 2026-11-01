"""The admin driver directory: list, detail, approval and activation.

Source: docs/api/admin-directory.md, "Drivers" (agreed, G3, #43) and
docs/api/partners.md, "Approval status" (SRS FR-001, FR-002, FR-003, FR-013,
FR-031, BR-03, NFR-003, NFR-004). Every endpoint is admin only (the router
uses ``CurrentAdmin``). The design says "rider" (Keke) and "driver"
(Tanker); the server role is ``driver`` for both.

Two decisions this module applies:

* **Approval and activation are separate** (FR-002). Activation is account
  access: a deactivated account cannot sign in at all. Approval is whether the
  partner may work: a pending or suspended partner can still sign in but cannot
  go online or be offered jobs. The admin endpoint is where a ``pending``
  partner leaves ``pending``; without it a partner who signs up waits forever.
* **A suspension or deactivation never strands a job.** An ``offered`` job is
  taken back as the dispatcher's withdraw does (the order returns to
  ``confirmed``, reason ``reassigned``); an ``accepted`` job is not touched and
  the change is refused with 409 ``driver_has_accepted_job``, so the job ends
  first (open question 12, decided).

Order and assignment figures come from :mod:`app.modules.dispatch.service`,
which owns assignments; this module never reads the assignments table itself.
"""

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from http import HTTPStatus

from sqlalchemy import ColumnElement, Select, String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.audit import service as audit_service
from app.modules.auth.models import User, UserRole
from app.modules.dispatch import service as dispatch_service
from app.modules.dispatch.models import (
    ApprovalStatus,
    AssignmentStatus,
    DeliveryType,
    DriverProfile,
    DriverServiceZone,
    VehicleProfile,
)
from app.modules.notifications import service as notifications_service
from app.modules.pricing.models import ServiceZone

#: Digits needed before ``q`` is also matched against phones (as for customers).
PHONE_SEARCH_MIN_DIGITS = 4
#: ``+234`` is replaced by ``0`` to give the local form of a Nigerian number.
_E164_PREFIX_LENGTH = len("+234")
AUDIT_TARGET_TYPE = "driver"
#: The notification kind for an approval status change (partners.md, "Notifications").
NOTIFICATION_ACCOUNT = "account"


@dataclass(frozen=True)
class VehicleInput:
    """The vehicle an administrator verified in person (FR-013).

    Attributes:
        description: The vehicle profile's text, for example "Tanker truck".
        safe_payload_litres: The verified safe payload per trip, in litres.
        transfer_methods: ``ground`` and ``overhead`` values, may be empty.
    """

    description: str
    safe_payload_litres: int
    transfer_methods: Sequence[str]


@dataclass(frozen=True)
class DriverRow:
    """A driver account with everything the directory shows.

    Attributes:
        user: The driver's account.
        profile: Their dispatch profile (approval, availability, declared vehicle).
        vehicle: The verified vehicle profile, or None until an admin links one.
        zones: The zones they serve, the sign-up zone first.
        live_jobs: Assignments ``offered`` or ``accepted``.
        completed_jobs: Assignments ``completed``.
        delivered_jobs: ``completed`` assignments whose order is ``delivered`` (#275).
    """

    user: User
    profile: DriverProfile
    vehicle: VehicleProfile | None
    zones: list[ServiceZone]
    live_jobs: int
    completed_jobs: int
    delivered_jobs: int


@dataclass(frozen=True)
class DriverCounts:
    """Counts over every driver, ignoring the list filters.

    ``available`` uses the dashboard's definition: active, approved and
    available, so the header and the dashboard agree.
    """

    all: int
    keke: int
    tanker: int
    pending: int
    inactive: int
    available: int


@dataclass(frozen=True)
class DriverPage:
    """One page of the driver list.

    Attributes:
        rows: The drivers on this page, by name.
        total: Drivers matching the filters, across all pages.
        counts: The pill counts over every driver.
    """

    rows: list[DriverRow]
    total: int
    counts: DriverCounts


def _driver_not_found() -> APIError:
    return APIError(HTTPStatus.NOT_FOUND, "driver_not_found", "Driver not found")


def _search_filter(q: str) -> ColumnElement[bool]:
    """Match a part of the name, the vehicle type or, with enough digits, the phone.

    "Vehicle type" is the verified description ("Tanker truck") and the
    declared kind (``keke`` or ``tanker``), so a pending partner with no
    verified vehicle is still found by "keke". The phone is matched in its
    stored E.164 form and in the local ``0...`` form. ``autoescape`` keeps
    ``%`` and ``_`` in ``q`` literal.
    """
    conditions: list[ColumnElement[bool]] = [
        User.name.icontains(q, autoescape=True),
        VehicleProfile.vehicle_type.icontains(q, autoescape=True),
        cast(DriverProfile.delivery_type, String).icontains(q, autoescape=True),
    ]
    digits = re.sub(r"\D", "", q)
    if len(digits) >= PHONE_SEARCH_MIN_DIGITS:
        local_phone = func.concat("0", func.substr(User.phone, _E164_PREFIX_LENGTH + 1))
        conditions += [User.phone.contains(digits), local_phone.contains(digits)]
    return or_(*conditions)


async def _rows(
    session: AsyncSession, profiles: Sequence[tuple[User, DriverProfile, VehicleProfile | None]]
) -> list[DriverRow]:
    """Add the zones and job counts to a page of drivers, in as few queries as possible."""
    if not profiles:
        return []
    zone_rows = await session.execute(
        select(DriverServiceZone.driver_profile_id, ServiceZone)
        .join(ServiceZone, ServiceZone.id == DriverServiceZone.zone_id)
        .where(DriverServiceZone.driver_profile_id.in_([profile.id for _, profile, _ in profiles]))
        # The sign-up zone is the first row (partners.md).
        .order_by(DriverServiceZone.created_at, DriverServiceZone.id)
    )
    zones: dict[uuid.UUID, list[ServiceZone]] = {}
    for profile_id, zone in zone_rows:
        zones.setdefault(profile_id, []).append(zone)
    counts = await dispatch_service.job_counts_by_driver(
        session, [user.id for user, _, _ in profiles]
    )
    rows = []
    for user, profile, vehicle in profiles:
        job_counts = counts.get(user.id)
        rows.append(
            DriverRow(
                user=user,
                profile=profile,
                vehicle=vehicle,
                zones=zones.get(profile.id, []),
                live_jobs=job_counts.live if job_counts else 0,
                completed_jobs=job_counts.completed if job_counts else 0,
                delivered_jobs=job_counts.delivered if job_counts else 0,
            )
        )
    return rows


def _base_query() -> Select[tuple[User, DriverProfile, VehicleProfile | None]]:
    # A driver with no dispatch profile cannot work (dispatch answers
    # ``no_driver_profile``) and has no approval status to show, so the
    # directory lists accounts that have one.
    return (
        select(User, DriverProfile, VehicleProfile)
        .join(DriverProfile, DriverProfile.user_id == User.id)
        .outerjoin(VehicleProfile, VehicleProfile.id == DriverProfile.vehicle_profile_id)
        .where(User.role == UserRole.DRIVER)
    )


async def _counts(session: AsyncSession) -> DriverCounts:
    row = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(DriverProfile.delivery_type == DeliveryType.KEKE),
                func.count().filter(DriverProfile.delivery_type == DeliveryType.TANKER),
                func.count().filter(
                    User.is_active.is_(True),
                    DriverProfile.approval_status == ApprovalStatus.PENDING,
                ),
                func.count().filter(User.is_active.is_(False)),
                func.count().filter(
                    User.is_active.is_(True),
                    DriverProfile.approval_status == ApprovalStatus.APPROVED,
                    DriverProfile.is_available.is_(True),
                ),
            )
            .select_from(User)
            .join(DriverProfile, DriverProfile.user_id == User.id)
            .where(User.role == UserRole.DRIVER)
        )
    ).one()
    return DriverCounts(*row)


async def list_drivers(
    session: AsyncSession,
    *,
    delivery_type: DeliveryType | None,
    approval_status: ApprovalStatus | None,
    is_active: bool | None,
    q: str | None,
    limit: int,
    offset: int,
) -> DriverPage:
    """List drivers by name, with the pill counts.

    Args:
        session: Database session.
        delivery_type: Optional ``keke`` or ``tanker``.
        approval_status: Optional approval filter.
        is_active: Optional account-access filter (``false`` lists deactivated).
        q: Optional search text (already trimmed, 1-100 characters).
        limit: Page size.
        offset: Rows to skip.

    Returns:
        The page, the number of matches and the counts over every driver.
    """
    query = _base_query()
    if delivery_type is not None:
        query = query.where(DriverProfile.delivery_type == delivery_type)
    if approval_status is not None:
        query = query.where(DriverProfile.approval_status == approval_status)
    if is_active is not None:
        query = query.where(User.is_active.is_(is_active))
    if q is not None:
        query = query.where(_search_filter(q))
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    found = (
        await session.execute(
            query.order_by(func.lower(User.name), User.id).limit(limit).offset(offset)
        )
    ).all()
    rows = await _rows(session, [(user, profile, vehicle) for user, profile, vehicle in found])
    return DriverPage(rows=rows, total=total, counts=await _counts(session))


async def get_driver(session: AsyncSession, driver_id: uuid.UUID) -> DriverRow:
    """Return one driver.

    Args:
        session: Database session.
        driver_id: The driver's account id.

    Returns:
        The driver.

    Raises:
        APIError: 404 ``driver_not_found`` for an unknown id, an account that
            is not a driver, or a driver with no dispatch profile.
    """
    found = (await session.execute(_base_query().where(User.id == driver_id))).first()
    if found is None:
        raise _driver_not_found()
    user, profile, vehicle = found
    return (await _rows(session, [(user, profile, vehicle)]))[0]


async def _lock_driver(session: AsyncSession, driver_id: uuid.UUID) -> tuple[User, DriverProfile]:
    """Load and lock a driver's account and profile, so two admins cannot race."""
    found = (
        await session.execute(
            select(User, DriverProfile)
            .join(DriverProfile, DriverProfile.user_id == User.id)
            .where(User.id == driver_id, User.role == UserRole.DRIVER)
            .with_for_update()
        )
    ).first()
    if found is None:
        await session.rollback()
        raise _driver_not_found()
    return found[0], found[1]


def _accepted_job() -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "driver_has_accepted_job",
        "This driver has a job in progress. Let it end first.",
    )


async def _release_offered_job(session: AsyncSession, *, admin: User, driver: User) -> None:
    """Take back the driver's offered job, or refuse while they hold an accepted one.

    The withdraw is the dispatcher's own (``reassigned``, the driver is told),
    written in the caller's transaction. An offer the driver accepts between
    this read and the withdraw is refused by the withdraw's own check, which
    is reported as the accepted job it now is.

    Raises:
        APIError: 409 ``driver_has_accepted_job``.
    """
    live = await dispatch_service.live_assignment_of_driver(session, driver.id)
    if live is None:
        return
    if live.status is AssignmentStatus.ACCEPTED:
        await session.rollback()
        raise _accepted_job()
    try:
        await dispatch_service.withdraw_assignment(
            session,
            order_id=live.order_id,
            admin=admin,
            expected_status=AssignmentStatus.OFFERED,
            note=None,
            commit=False,
        )
    except APIError as error:
        if error.code == "invalid_order_transition":
            raise _accepted_job() from error
        raise


def _blank_to_none(reason: str | None) -> str | None:
    return reason or None


async def set_approval(
    session: AsyncSession,
    *,
    admin: User,
    driver_id: uuid.UUID,
    approval_status: ApprovalStatus,
    reason: str | None,
    vehicle: VehicleInput | None,
) -> DriverRow:
    """Approve or suspend a partner. Commits.

    Approving is also when the administrator records the vehicle they checked
    in person (FR-013): with ``vehicle`` the server creates a vehicle profile,
    or updates the one linked only to this driver, links it, and stores the
    transfer methods on the driver profile; the declared capacity and plate are
    not changed. A vehicle profile shared with another driver (the
    command-line tool can link one profile to several) is never changed for
    one driver: a new profile is created for this one instead.

    Asking for the state the partner is already in, with no ``vehicle``,
    returns the partner unchanged and writes nothing. Availability is never set
    to true here; suspending sets it to false.

    Args:
        session: Database session; committed or rolled back here.
        admin: The signed-in administrator; the audit actor (NFR-004).
        driver_id: The driver's account id.
        approval_status: ``approved`` or ``suspended``.
        reason: Required (5-500) to suspend, optional to approve.
        vehicle: The verified vehicle. Required to approve a partner with no
            verified vehicle yet; not allowed to suspend (the schema checks).

    Returns:
        The driver after the change.

    Raises:
        APIError: 404 ``driver_not_found``; 409 ``driver_inactive``; 409
            ``partner_phone_not_verified``; 409 ``driver_has_accepted_job``;
            422 ``validation_error`` when approving needs a vehicle.
    """
    reason = _blank_to_none(reason)
    user, profile = await _lock_driver(session, driver_id)
    if profile.approval_status is approval_status and vehicle is None:
        await session.rollback()
        return await get_driver(session, driver_id)
    if not user.is_active:
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "driver_inactive",
            "This account is deactivated. Activate it first.",
        )
    if approval_status is ApprovalStatus.APPROVED:
        if user.phone_verified_at is None:
            await session.rollback()
            raise APIError(
                HTTPStatus.CONFLICT,
                "partner_phone_not_verified",
                "The partner must verify their phone before you can approve them.",
            )
        if vehicle is None and profile.vehicle_profile_id is None:
            await session.rollback()
            raise APIError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "validation_error",
                "Request validation failed",
                details=[
                    {
                        "loc": ["body", "vehicle"],
                        "msg": "Record the verified vehicle to approve this partner",
                        "type": "value_error",
                    }
                ],
            )
    else:
        await _release_offered_job(session, admin=admin, driver=user)
        profile.is_available = False
    status_changed = profile.approval_status is not approval_status
    details: dict[str, object] = {}
    if reason is not None:
        details["reason"] = reason
    if vehicle is not None:
        linked = await _record_vehicle(session, profile, vehicle)
        details.update(
            vehicle_profile_id=str(linked.id),
            safe_payload_litres=vehicle.safe_payload_litres,
            transfer_methods=list(vehicle.transfer_methods),
        )
    profile.approval_status = approval_status
    audit_service.record(
        session,
        actor_id=admin.id,
        action="driver_approved"
        if approval_status is ApprovalStatus.APPROVED
        else "driver_suspended",
        target_type=AUDIT_TARGET_TYPE,
        target_id=user.id,
        details=details,
    )
    if status_changed:
        _notify_status(session, user, approval_status)
    await session.commit()
    return await get_driver(session, driver_id)


async def _record_vehicle(
    session: AsyncSession, profile: DriverProfile, vehicle: VehicleInput
) -> VehicleProfile:
    """Create or update the driver's own vehicle profile and link it (FR-013)."""
    linked = (
        await session.get(VehicleProfile, profile.vehicle_profile_id)
        if profile.vehicle_profile_id is not None
        else None
    )
    if linked is not None:
        shared = await session.scalar(
            select(func.count())
            .select_from(DriverProfile)
            .where(DriverProfile.vehicle_profile_id == linked.id, DriverProfile.id != profile.id)
        )
        if shared:
            linked = None  # never change another driver's verified payload
    if linked is None:
        linked = VehicleProfile(
            vehicle_type=vehicle.description, safe_payload_litres=vehicle.safe_payload_litres
        )
        session.add(linked)
        await session.flush()
    else:
        linked.vehicle_type = vehicle.description
        linked.safe_payload_litres = vehicle.safe_payload_litres
    profile.vehicle_profile_id = linked.id
    profile.transfer_methods = list(vehicle.transfer_methods)
    return linked


def _notify_status(session: AsyncSession, user: User, approval_status: ApprovalStatus) -> None:
    """Tell the partner their approval status changed, in-app only (partners.md, FR-050).

    The staff reason is not copied into the message: it is an internal note.
    """
    if approval_status is ApprovalStatus.APPROVED:
        title, body = (
            "Your account was approved",
            "You can go online and be offered jobs.",
        )
    else:
        title, body = (
            "Your account was suspended",
            "You cannot go online or be offered jobs until an administrator approves you again.",
        )
    notifications_service.add(
        session, user_id=user.id, kind=NOTIFICATION_ACCOUNT, title=title, body=body
    )


async def set_activation(
    session: AsyncSession,
    *,
    admin: User,
    driver_id: uuid.UUID,
    is_active: bool,
    reason: str | None,
) -> DriverRow:
    """Activate or deactivate a partner's account (FR-002). Commits.

    Deactivating stops the account's sessions and sign-in (the auth layer
    checks ``users.is_active``). A live ``offered`` job is taken back first;
    an ``accepted`` job refuses the change. Activating changes neither the
    partner's availability nor their approval status, so only an ``approved``
    partner can be offered work again. Asking for the state the driver is
    already in returns them unchanged and writes nothing.

    Args:
        session: Database session; committed or rolled back here.
        admin: The signed-in administrator; the audit actor (NFR-004).
        driver_id: The driver's account id.
        is_active: The new state.
        reason: Required (5-500) to deactivate, optional to activate.

    Returns:
        The driver after the change.

    Raises:
        APIError: 404 ``driver_not_found``; 409 ``driver_has_accepted_job``.
    """
    reason = _blank_to_none(reason)
    user, _ = await _lock_driver(session, driver_id)
    if user.is_active is is_active:
        await session.rollback()
        return await get_driver(session, driver_id)
    if not is_active:
        await _release_offered_job(session, admin=admin, driver=user)
    user.is_active = is_active
    audit_service.record(
        session,
        actor_id=admin.id,
        action="driver_activated" if is_active else "driver_deactivated",
        target_type=AUDIT_TARGET_TYPE,
        target_id=user.id,
        details={"reason": reason} if reason is not None else {},
    )
    await session.commit()
    return await get_driver(session, driver_id)
