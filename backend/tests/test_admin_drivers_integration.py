"""The admin driver directory against a real, migrated database (#45, part 2).

docs/api/admin-directory.md, "Drivers": the list (filters, search by name,
vehicle type and phone, the pill counts, job counts, the sign-up zone first),
approval with vehicle verification (the phone must be verified, the account
active, the declared vehicle left alone, a shared vehicle profile never changed
for another driver), suspension and deactivation taking back an offered job and
refusing an accepted one, no-op repeats, the audit rows and the partner's
``account`` notification.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Everything created is deleted afterwards, children first (the partner tests'
``created`` fixture).
"""

import uuid
from datetime import UTC, datetime
from http import HTTPStatus

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import APIError
from app.modules.audit.models import AuditLog
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.dispatch import service as dispatch_service
from app.modules.dispatch.models import (
    ApprovalStatus,
    Assignment,
    AssignmentStatus,
    DriverProfile,
    DriverServiceZone,
)
from app.modules.notifications import service as notifications_service
from app.modules.orders.models import Order, OrderStatus
from app.modules.partners import directory
from app.modules.partners.directory import VehicleInput
from tests import test_partners_integration as partner_tests
from tests.test_dispatch_integration import add_driver, add_user, confirmed_order, status_of
from tests.test_orders_integration import TEST_DATABASE_URL, run

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

created = partner_tests.created
Created = partner_tests.Created
Sessions = async_sessionmaker[AsyncSession]

VEHICLE = VehicleInput(
    description="Tanker truck", safe_payload_litres=12_000, transfer_methods=["ground", "overhead"]
)
REASON = "Vehicle papers expired"


async def rename(sessions: Sessions, user: User, name: str) -> None:
    async with sessions() as session:
        await session.execute(update(User).where(User.id == user.id).values(name=name))
        await session.commit()


async def verify_phone(sessions: Sessions, user: User) -> None:
    async with sessions() as session:
        stored = await session.get(User, user.id)
        assert stored is not None
        await auth_service.set_phone_verified(session, stored)


async def pending_partner(sessions: Sessions, created: Created, *, verified: bool = True) -> User:
    zone = await partner_tests.add_zone(sessions, created)
    partner = await partner_tests.sign_up(sessions, created, zone)
    if verified:
        await verify_phone(sessions, partner)
    return partner


async def profile_of(sessions: Sessions, user: User) -> DriverProfile:
    async with sessions() as session:
        profile = await session.scalar(
            select(DriverProfile).where(DriverProfile.user_id == user.id)
        )
    assert profile is not None
    return profile


async def active(sessions: Sessions, user: User, *, is_active: bool) -> None:
    async with sessions() as session:
        await session.execute(update(User).where(User.id == user.id).values(is_active=is_active))
        await session.commit()


def track_vehicle(created: Created, profile: DriverProfile) -> None:
    """Make sure the test cleanup also deletes a vehicle profile the service created."""
    if (
        profile.vehicle_profile_id is not None
        and profile.vehicle_profile_id not in created.vehicle_ids
    ):
        created.vehicle_ids.append(profile.vehicle_profile_id)


async def change_approval(
    sessions: Sessions,
    admin: User,
    driver: User,
    status: ApprovalStatus,
    *,
    reason: str | None = None,
    vehicle: VehicleInput | None = None,
) -> directory.DriverRow:
    async with sessions() as session:
        return await directory.set_approval(
            session,
            admin=admin,
            driver_id=driver.id,
            approval_status=status,
            reason=reason,
            vehicle=vehicle,
        )


async def approve(
    sessions: Sessions,
    admin: User,
    driver: User,
    *,
    vehicle: VehicleInput | None = VEHICLE,
    reason: str | None = None,
) -> directory.DriverRow:
    return await change_approval(
        sessions, admin, driver, ApprovalStatus.APPROVED, reason=reason, vehicle=vehicle
    )


async def suspend(sessions: Sessions, admin: User, driver: User) -> directory.DriverRow:
    return await change_approval(sessions, admin, driver, ApprovalStatus.SUSPENDED, reason=REASON)


async def set_active(
    sessions: Sessions, admin: User, driver: User, *, is_active: bool, reason: str | None = REASON
) -> directory.DriverRow:
    async with sessions() as session:
        return await directory.set_activation(
            session, admin=admin, driver_id=driver.id, is_active=is_active, reason=reason
        )


async def audit_rows(sessions: Sessions, driver: User, action: str) -> list[AuditLog]:
    async with sessions() as session:
        rows = await session.scalars(
            select(AuditLog).where(AuditLog.target_id == driver.id, AuditLog.action == action)
        )
        return list(rows)


async def kinds(sessions: Sessions, user: User) -> list[str]:
    async with sessions() as session:
        page = await notifications_service.list_for_user(
            session, user_id=user.id, limit=50, offset=0
        )
    return [item.notification.kind for item in page.items]


async def refused(coro: object) -> APIError:
    with pytest.raises(APIError) as caught:
        await coro  # type: ignore[misc]
    return caught.value


async def offer(sessions: Sessions, created: Created, admin: User, driver: User) -> Order:
    order = await confirmed_order(sessions, created)
    async with sessions() as session:
        await dispatch_service.assign_driver(
            session, order_id=order.id, driver_user_id=driver.id, admin=admin
        )
    return order


async def accept(sessions: Sessions, order: Order, driver: User) -> None:
    async with sessions() as session:
        await dispatch_service.accept_assignment(session, order_id=order.id, driver=driver)


async def make_available_and_approved(sessions: Sessions, driver: User) -> None:
    # add_driver gives a driver with a vehicle; make them eligible and verified.
    async with sessions() as session:
        await session.execute(
            update(DriverProfile)
            .where(DriverProfile.user_id == driver.id)
            .values(approval_status=ApprovalStatus.APPROVED, is_available=True)
        )
        await session.commit()
    await verify_phone(sessions, driver)


def test_list_filters_search_counts_and_job_counts(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        marker = uuid.uuid4().hex[:8]
        before = await _counts(sessions)
        partner = await pending_partner(sessions, created)  # a pending tanker partner
        driver = await add_driver(sessions, created)  # approved, "Sample tricycle"
        await make_available_and_approved(sessions, driver)
        await rename(sessions, partner, f"zed {marker}")
        await rename(sessions, driver, f"Alpha {marker}")
        extra_zone = await partner_tests.add_zone(sessions, created)
        profile = await profile_of(sessions, partner)
        async with sessions() as session:
            session.add(DriverServiceZone(driver_profile_id=profile.id, zone_id=extra_zone.id))
            await session.commit()

        async def listed(**filters: object) -> directory.DriverPage:
            params: dict[str, object] = {
                "delivery_type": None,
                "approval_status": None,
                "is_active": None,
                "q": marker,
                "limit": 50,
                "offset": 0,
            } | filters
            async with sessions() as session:
                return await directory.list_drivers(session, **params)  # type: ignore[arg-type]

        both = await listed()
        assert [row.user.id for row in both.rows] == [driver.id, partner.id]  # by name, any case
        assert both.total == 2
        assert [r.user.id for r in (await listed(approval_status=ApprovalStatus.PENDING)).rows] == [
            partner.id
        ]
        tanker = await listed(delivery_type=partner_tests.DeliveryType.TANKER)
        assert [row.user.id for row in tanker.rows] == [partner.id]
        assert (await listed(is_active=False)).total == 0
        # The vehicle type: the verified description, and the declared kind.
        assert driver.id in [r.user.id for r in (await listed(q="tricycle")).rows]
        assert partner.id in [r.user.id for r in (await listed(q="TANKER")).rows]
        # A phone in the local form, with at least 4 digits.
        local = "0" + partner.phone[4:]
        assert [r.user.id for r in (await listed(q=local)).rows] == [partner.id]
        # Pending partners have no verified vehicle; the declared one is shown.
        pending_row = tanker.rows[0]
        assert pending_row.vehicle is None
        assert pending_row.profile.plate is not None
        assert [zone.id for zone in pending_row.zones][1] == extra_zone.id  # sign-up zone first
        assert len(pending_row.zones) == 2

        after = await _counts(sessions)
        assert after.all - before.all == 2
        assert after.tanker - before.tanker == 1
        assert after.pending - before.pending == 1
        assert after.available - before.available == 1  # the approved, available driver only
        assert after.inactive == before.inactive

        # Job counts: an offered job is live, a completed one is completed.
        order = await offer(sessions, created, admin, driver)
        done = await confirmed_order(sessions, created)
        async with sessions() as session:
            session.add(
                Assignment(
                    order_id=done.id,
                    driver_user_id=driver.id,
                    status=AssignmentStatus.COMPLETED,
                    offered_by=admin.id,
                    ended_at=datetime.now(UTC),
                )
            )
            await session.commit()
        row = (await listed(q=driver.phone[-7:])).rows[0]
        assert (row.live_jobs, row.completed_jobs) == (1, 1)
        assert order.id != done.id
        # That completed job's order is not delivered, so it is no trip (#275).
        assert row.delivered_jobs == 0

        # Trips (#275): a failed, a cancelled and a delivered job all end
        # `completed`; only the delivered one is a trip.
        for ending in (OrderStatus.FAILED, OrderStatus.CANCELLED, OrderStatus.DELIVERED):
            ended = await confirmed_order(sessions, created)
            async with sessions() as session:
                await session.execute(
                    update(Order).where(Order.id == ended.id).values(status=ending)
                )
                session.add(
                    Assignment(
                        order_id=ended.id,
                        driver_user_id=driver.id,
                        status=AssignmentStatus.COMPLETED,
                        offered_by=admin.id,
                        ended_at=datetime.now(UTC),
                    )
                )
                await session.commit()
        row = (await listed(q=driver.phone[-7:])).rows[0]
        assert (row.live_jobs, row.completed_jobs, row.delivered_jobs) == (1, 4, 1)

    run(scenario)


async def _counts(sessions: Sessions) -> directory.DriverCounts:
    async with sessions() as session:
        page = await directory.list_drivers(
            session,
            delivery_type=None,
            approval_status=None,
            is_active=None,
            q=None,
            limit=1,
            offset=0,
        )
    return page.counts


def test_an_id_that_is_not_a_driver_with_a_profile_is_not_found(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        customer = await add_user(sessions, created, UserRole.CUSTOMER)
        no_profile = await add_user(sessions, created, UserRole.DRIVER)
        for account_id in (admin.id, customer.id, no_profile.id, uuid.uuid4()):
            async with sessions() as session:
                error = await refused(directory.get_driver(session, account_id))
            assert (error.status_code, error.code) == (HTTPStatus.NOT_FOUND, "driver_not_found")
            async with sessions() as session:
                error = await refused(
                    directory.set_activation(
                        session, admin=admin, driver_id=account_id, is_active=False, reason=REASON
                    )
                )
            assert error.code == "driver_not_found"

    run(scenario)


def test_approving_records_the_verified_vehicle_and_tells_the_partner(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        partner = await pending_partner(sessions, created)
        before = await profile_of(sessions, partner)

        row = await approve(sessions, admin, partner)
        track_vehicle(created, row.profile)

        assert row.profile.approval_status is ApprovalStatus.APPROVED
        assert row.vehicle is not None
        assert (row.vehicle.vehicle_type, row.vehicle.safe_payload_litres) == (
            "Tanker truck",
            12_000,
        )
        assert list(row.profile.transfer_methods) == ["ground", "overhead"]
        # The declared fields are the partner's own and stay; availability is theirs to set.
        assert (row.profile.plate, row.profile.declared_capacity_gallons) == (
            before.plate,
            before.declared_capacity_gallons,
        )
        assert row.profile.is_available is False
        assert await kinds(sessions, partner) == ["account"]
        (log,) = await audit_rows(sessions, partner, "driver_approved")
        assert log.actor_id == admin.id and log.target_type == "driver"
        assert log.details == {
            "vehicle_profile_id": str(row.vehicle.id),
            "safe_payload_litres": 12_000,
            "transfer_methods": ["ground", "overhead"],
        }  # no phone, plate or name

    run(scenario)


def test_approving_is_refused_without_a_verified_phone_a_vehicle_or_an_active_account(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        unverified = await pending_partner(sessions, created, verified=False)
        error = await refused(approve(sessions, admin, unverified))
        assert (error.status_code, error.code) == (409, "partner_phone_not_verified")

        verified = await pending_partner(sessions, created)
        error = await refused(approve(sessions, admin, verified, vehicle=None))
        assert (error.status_code, error.code) == (422, "validation_error")
        assert error.details == [
            {
                "loc": ["body", "vehicle"],
                "msg": "Record the verified vehicle to approve this partner",
                "type": "value_error",
            }
        ]

        await active(sessions, verified, is_active=False)
        for refusal in (approve(sessions, admin, verified), suspend(sessions, admin, verified)):
            error = await refused(refusal)
            assert (error.status_code, error.code) == (409, "driver_inactive")

        # Nothing was changed, audited or sent by any refusal.
        for partner in (unverified, verified):
            stored = await profile_of(sessions, partner)
            assert stored.approval_status is ApprovalStatus.PENDING
            assert stored.vehicle_profile_id is None
            assert await kinds(sessions, partner) == []
            assert await audit_rows(sessions, partner, "driver_approved") == []

    run(scenario)


def test_repeating_the_same_state_changes_nothing_and_a_new_vehicle_replaces_the_old(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        partner = await pending_partner(sessions, created)
        first = await approve(sessions, admin, partner)
        track_vehicle(created, first.profile)
        assert first.vehicle is not None

        again = await approve(sessions, admin, partner, vehicle=None)  # already approved
        assert again.profile.approval_status is ApprovalStatus.APPROVED
        assert len(await audit_rows(sessions, partner, "driver_approved")) == 1
        assert await kinds(sessions, partner) == ["account"]  # no second message

        corrected = VehicleInput("Tanker truck, large", 15_000, ["ground"])
        replaced = await approve(sessions, admin, partner, vehicle=corrected)
        assert replaced.vehicle is not None
        assert replaced.vehicle.id == first.vehicle.id  # the driver's own profile, updated
        assert (replaced.vehicle.vehicle_type, replaced.vehicle.safe_payload_litres) == (
            "Tanker truck, large",
            15_000,
        )
        assert list(replaced.profile.transfer_methods) == ["ground"]
        assert len(await audit_rows(sessions, partner, "driver_approved")) == 2
        assert await kinds(sessions, partner) == ["account"]  # the status did not change

    run(scenario)


def test_a_vehicle_profile_shared_with_another_driver_is_never_changed(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        sharing = await add_driver(sessions, created, payload=1200)
        other = await add_driver(sessions, created, payload=800)
        await verify_phone(sessions, sharing)
        shared_id = (await profile_of(sessions, sharing)).vehicle_profile_id
        async with sessions() as session:  # link the same profile to both drivers
            await session.execute(
                update(DriverProfile)
                .where(DriverProfile.user_id == other.id)
                .values(vehicle_profile_id=shared_id)
            )
            await session.commit()
        await make_available_and_approved(sessions, sharing)

        row = await approve(sessions, admin, sharing)  # a new verified vehicle for one driver
        track_vehicle(created, row.profile)

        assert row.vehicle is not None and row.vehicle.id != shared_id
        untouched = await profile_of(sessions, other)
        assert untouched.vehicle_profile_id == shared_id
        async with sessions() as session:
            shared = await session.get(type(row.vehicle), shared_id)
        assert shared is not None and shared.safe_payload_litres == 1200

    run(scenario)


def test_suspending_takes_back_an_offered_job_turns_availability_off_and_audits(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        await make_available_and_approved(sessions, driver)
        order = await offer(sessions, created, admin, driver)

        row = await suspend(sessions, admin, driver)

        assert row.profile.approval_status is ApprovalStatus.SUSPENDED
        assert row.profile.is_available is False
        assert row.live_jobs == 0
        assert await status_of(sessions, order.id) is OrderStatus.CONFIRMED
        # The take-back and the status message are written in one transaction, so they share a
        # time and their order in the list is not defined; compare the set.
        assert sorted(await kinds(sessions, driver)) == ["account", "assigned", "reassigned"]
        (log,) = await audit_rows(sessions, driver, "driver_suspended")
        assert log.details == {"reason": REASON}

        # Back to approved needs no vehicle: the verified one is still linked.
        back = await approve(sessions, admin, driver, vehicle=None)
        assert back.profile.approval_status is ApprovalStatus.APPROVED
        assert back.profile.is_available is False  # the partner goes online themselves

    run(scenario)


def test_suspending_or_deactivating_is_refused_while_a_job_is_accepted(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        await make_available_and_approved(sessions, driver)
        order = await offer(sessions, created, admin, driver)
        await accept(sessions, order, driver)

        for change in (
            suspend(sessions, admin, driver),
            set_active(sessions, admin, driver, is_active=False),
        ):
            error = await refused(change)
            assert (error.status_code, error.code) == (409, "driver_has_accepted_job")

        stored = await profile_of(sessions, driver)
        assert stored.approval_status is ApprovalStatus.APPROVED and stored.is_available is True
        async with sessions() as session:
            user = await session.get(User, driver.id)
            assignment = await session.scalar(
                select(Assignment).where(Assignment.order_id == order.id)
            )
        assert user is not None and user.is_active is True
        assert assignment is not None and assignment.status is AssignmentStatus.ACCEPTED
        assert await audit_rows(sessions, driver, "driver_suspended") == []
        assert await audit_rows(sessions, driver, "driver_deactivated") == []

    run(scenario)


def test_deactivating_takes_back_an_offered_job_and_activating_changes_nothing_else(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_driver(sessions, created)
        await make_available_and_approved(sessions, driver)
        order = await offer(sessions, created, admin, driver)

        off = await set_active(sessions, admin, driver, is_active=False)

        assert off.user.is_active is False
        assert off.live_jobs == 0
        assert await status_of(sessions, order.id) is OrderStatus.CONFIRMED
        (log,) = await audit_rows(sessions, driver, "driver_deactivated")
        assert log.target_type == "driver" and log.details == {"reason": REASON}
        # Asking for the state they are already in writes nothing.
        await set_active(sessions, admin, driver, is_active=False)
        assert len(await audit_rows(sessions, driver, "driver_deactivated")) == 1

        on = await set_active(sessions, admin, driver, is_active=True, reason=None)
        assert on.user.is_active is True
        assert on.profile.approval_status is ApprovalStatus.APPROVED  # unchanged
        assert on.profile.is_available is True  # unchanged
        (activated,) = await audit_rows(sessions, driver, "driver_activated")
        assert activated.details == {}

    run(scenario)
