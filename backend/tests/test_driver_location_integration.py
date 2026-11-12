"""Real PostGIS locking, consent, overwrite and clearing checks (#410)."""

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import APIError
from app.modules.auth import service as auth_service
from app.modules.auth.models import UserRole
from app.modules.dispatch import service as dispatch
from app.modules.dispatch.models import ApprovalStatus, DriverProfile
from app.modules.partners import directory, location, service
from app.modules.partners.location_schemas import DriverLocationUpdate
from app.modules.partners.models import DriverLocation
from app.modules.privacy import service as privacy
from tests.test_dispatch_integration import add_driver, add_user
from tests.test_orders_integration import TEST_DATABASE_URL, run
from tests.test_partners_integration import Created
from tests.test_partners_integration import created as partner_created

created = partner_created

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]


def body(grant: int, **changes: Any) -> DriverLocationUpdate:
    return DriverLocationUpdate.model_validate(
        {
            "location": {"latitude": 6.452713, "longitude": 7.510348},
            "accuracy_metres": 0.4,
            "grant": grant,
            **changes,
        }
    )


async def seed(sessions: async_sessionmaker[AsyncSession], created: Created) -> tuple[Any, int]:
    driver = await add_driver(sessions, created)
    async with sessions() as session:
        grant = await location.grant_sharing(session, driver)
        await location.confirm_location(session, driver, body(grant))
    return driver, grant


def test_overwrite_grant_rotation_and_profile_privacy(created: Created) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        driver, grant = await seed(sessions, created)
        async with sessions() as session:
            first = await service.get_profile(session, driver)
            assert first.location.state == "fresh" and first.location.accuracy_metres == 1
            result = await location.confirm_location(
                session, driver, body(grant, accuracy_metres=25.1)
            )
            assert result.accuracy_metres == 26
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(DriverLocation)
                    .where(DriverLocation.driver_id == driver.id)
                )
                == 1
            )
            assert set(result.model_dump()) == {
                "state",
                "sharing",
                "confirmed_at",
                "fresh_until",
                "accuracy_metres",
            }
            new_grant = await location.grant_sharing(session, driver)
            assert new_grant > grant
            with pytest.raises(APIError, match="consent") as raised:
                await location.confirm_location(session, driver, body(grant))
            assert raised.value.code == "location_sharing_withdrawn"
            await session.rollback()
            await location.confirm_location(session, driver, body(new_grant))

    run(scenario)


@pytest.mark.parametrize("off", [False, True], ids=["withdraw", "offline"])
@pytest.mark.parametrize("write_first", [False, True], ids=["clear-first", "write-first"])
def test_lock_interleavings_never_restore_cleared_point(
    created: Created, off: bool, write_first: bool
) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        driver, grant = await seed(sessions, created)
        async with sessions() as first, sessions() as second:
            # Simulate a profile cached before the other transaction clears it.
            cached = await second.scalar(
                select(DriverProfile).where(DriverProfile.user_id == driver.id)
            )
            assert cached is not None and cached.location_sharing_on
            profile = await location.lock_profile(first, driver.id)
            assert profile is not None
            # The second transaction must wait on the actual database row lock.
            if write_first:
                task = asyncio.create_task(
                    service.set_availability(second, driver, available=False)
                    if off
                    else location.withdraw_sharing(second, driver)
                )
            else:
                task = asyncio.create_task(location.confirm_location(second, driver, body(grant)))
            try:
                await asyncio.sleep(0.05)
                assert not task.done()
                if write_first:
                    await location.confirm_location(first, driver, body(grant))
                    await asyncio.wait_for(task, timeout=5)
                else:
                    if off:
                        await service.set_availability(first, driver, available=False)
                    else:
                        await location.withdraw_sharing(first, driver)
                    with pytest.raises(APIError) as raised:
                        await asyncio.wait_for(task, timeout=5)
                    assert raised.value.code == (
                        "driver_offline" if off else "location_sharing_withdrawn"
                    )
                    await second.rollback()
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
        async with sessions() as session:
            assert await session.get(DriverLocation, driver.id) is None
            partner = await service.get_profile(session, driver)
            assert not partner.location.sharing and partner.location.state == "none"
            assert partner.profile.is_available is (not off)
            await service.set_availability(session, driver, available=True)
            with pytest.raises(APIError) as raised:
                await location.confirm_location(session, driver, body(grant))
            assert raised.value.code == "location_sharing_withdrawn"
            await session.rollback()
            fresh_grant = await location.grant_sharing(session, driver)
            await location.confirm_location(session, driver, body(fresh_grant))

    run(scenario)


@pytest.mark.parametrize(
    "path", ["suspend", "admin-deactivate", "cli-deactivate", "cli-offline", "anonymize"]
)
def test_every_clearing_path_removes_point(created: Created, path: str) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        driver, grant = await seed(sessions, created)
        admin = await add_user(sessions, created, UserRole.ADMIN)
        async with sessions() as session:
            if path == "suspend":
                await directory.set_approval(
                    session,
                    admin=admin,
                    driver_id=driver.id,
                    approval_status=ApprovalStatus.SUSPENDED,
                    reason="Sample suspension",
                    vehicle=None,
                )
            elif path == "admin-deactivate":
                await directory.set_activation(
                    session,
                    admin=admin,
                    driver_id=driver.id,
                    is_active=False,
                    reason="Sample deactivation",
                )
            elif path == "cli-deactivate":
                await auth_service.set_user_active(session, phone=driver.phone, active=False)
            elif path == "cli-offline":
                await dispatch.set_driver_availability(session, phone=driver.phone, available=False)
            else:
                # Dry run rolls back both point deletion and grant invalidation.
                dry = await privacy.anonymize_partner(
                    session,
                    actor=admin,
                    partner_phone=driver.phone,
                    now=datetime.now(UTC),
                    apply=False,
                )
                assert dry.location_points_cleared == 1
                assert await session.get(DriverLocation, driver.id) is not None
                done = await privacy.anonymize_partner(
                    session,
                    actor=admin,
                    partner_phone=driver.phone,
                    now=datetime.now(UTC),
                    apply=True,
                )
                assert done.location_points_cleared == 1
        async with sessions() as session:
            assert await session.get(DriverLocation, driver.id) is None
            profile = await location.lock_profile(session, driver.id)
            assert profile is not None
            assert not profile.location_sharing_on and profile.location_sharing_grant > grant

    run(scenario)


@pytest.mark.parametrize("state", ["offline", "pending", "suspended", "inactive"])
def test_grant_and_point_refuse_ineligible_account(created: Created, state: str) -> None:
    async def scenario(sessions: async_sessionmaker[AsyncSession]) -> None:
        driver, grant = await seed(sessions, created)
        async with sessions() as session:
            if state == "inactive":
                await auth_service.set_user_active(session, phone=driver.phone, active=False)
            else:
                changes = (
                    {"is_available": False}
                    if state == "offline"
                    else {"approval_status": ApprovalStatus(state)}
                )
                await session.execute(
                    update(DriverProfile)
                    .where(DriverProfile.user_id == driver.id)
                    .values(**changes)
                )
                await session.commit()
        for operation in ["grant", "point"]:
            async with sessions() as session:
                with pytest.raises(APIError) as raised:
                    if operation == "grant":
                        await location.grant_sharing(session, driver)
                    else:
                        await location.confirm_location(session, driver, body(grant))
                assert raised.value.code == {
                    "offline": "driver_offline",
                    "inactive": "not_authenticated",
                }.get(state, "partner_not_approved")

    run(scenario)
