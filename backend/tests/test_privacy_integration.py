"""Privacy tool against a real database (#129, NFR-005).

Covers anonymizing a customer (refusals, dry run, the saved result, audit
row, sign-in impossible afterwards), correcting a name, and the monthly
retention review step by step, including what it must keep.

The review acts on the whole database, so these tests never let it see
anything but their own rows: their rows are dated 2017-2021 and the review
runs with ``now`` in 2021, before every other row in the test database.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every row is created here and deleted afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.audit.models import AuditLog
from app.modules.auth import service as auth_service
from app.modules.auth.models import PhoneVerification, User, UserRole, UserSession
from app.modules.customers import requests as customer_requests
from app.modules.customers.models import (
    CustomerAddress,
    DeletionRequest,
    DeletionRequestStatus,
    SupportRequest,
    SupportRequestStatus,
    SupportRequestType,
)
from app.modules.customers.requests import DeletionStatusRefused
from app.modules.deliveries.models import (
    AcknowledgementMethod,
    DeliveryAttempt,
    DeliveryCode,
    DeliveryProof,
    ExceptionCategory,
    HoldKind,
    OrderException,
    SmsStatus,
)
from app.modules.dispatch.models import (
    ApprovalStatus,
    Assignment,
    AssignmentStatus,
    DriverProfile,
    DriverServiceZone,
)
from app.modules.dispatch.models import DeliveryType as PartnerType
from app.modules.notifications.models import Notification
from app.modules.orders.models import Order, OrderStatus, PaymentMethod, PaymentStatus
from app.modules.payments.models import (
    CashCollection,
    CashCollectionStatus,
    CashRemittance,
)
from app.modules.pricing.models import ServiceZone
from app.modules.privacy import service
from tests import test_deliveries_integration as part1
from tests.test_deliveries_integration import (
    TEST_DATABASE_URL,
    Created,
    Sessions,
    Setup,
    add_job,
    add_user,
    run,
    setup,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

created = part1.created
# The review's clock: before every row other tests create (they use 2026).
REVIEW_NOW = datetime(2021, 6, 1, 9, 0, tzinfo=UTC)
OLD = datetime(2020, 1, 15, 9, 0, tzinfo=UTC)
POINT = "POINT(7.4951 6.4584)"
# Zones made by the saved-address tests, deleted after their addresses.
ZONE_IDS: list[uuid.UUID] = []


@pytest.fixture(autouse=True)
def delete_audit_rows(created: Created) -> Iterator[None]:
    """Delete this module's cash and audit rows before part 1 deletes orders and users."""
    yield
    url = get_settings().sync_database_url.set(drivername="postgresql")
    users = (created.user_ids,)
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        connection.execute("DELETE FROM cash_collections WHERE driver_id = ANY(%s)", users)
        connection.execute("DELETE FROM cash_remittances WHERE driver_id = ANY(%s)", users)
        connection.execute("DELETE FROM audit_logs WHERE actor_id = ANY(%s)", users)
        connection.execute("DELETE FROM customer_addresses WHERE customer_id = ANY(%s)", users)
        connection.execute("DELETE FROM support_requests WHERE user_id = ANY(%s)", users)
        connection.execute("DELETE FROM deletion_requests WHERE user_id = ANY(%s)", users)
        # Driver service zones go with their profile (ON DELETE CASCADE).
        connection.execute("DELETE FROM driver_profiles WHERE user_id = ANY(%s)", users)
        connection.execute("DELETE FROM service_zones WHERE id = ANY(%s)", (ZONE_IDS,))
    ZONE_IDS.clear()


async def finished_job(sessions: Sessions, s: Setup, driver: User, **fields: object) -> str:
    """``add_job`` with the assignment completed, as on a finished order.

    A driver may hold one live (offered or accepted) assignment only.
    """
    return await add_job(
        sessions,
        s,
        driver,
        assignment_status=AssignmentStatus.COMPLETED,
        ended_at=OLD,
        **fields,
    )


async def backdate_user(sessions: Sessions, user: User, at: datetime) -> None:
    async with sessions() as session:
        await session.execute(
            update(User).where(User.id == user.id).values(created_at=at, updated_at=at)
        )
        await session.commit()


async def add_codes_and_session(sessions: Sessions, user: User, *, expired_at: datetime) -> None:
    """A used phone code and a session, both expired at ``expired_at``."""
    async with sessions() as session:
        session.add(
            PhoneVerification(
                user_id=user.id,
                phone=user.phone,
                purpose="account_phone",
                code_hash="a" * 64,
                expires_at=expired_at,
                consumed_at=expired_at - timedelta(minutes=2),
            )
        )
        session.add(
            UserSession(user_id=user.id, token_hash=uuid.uuid4().hex * 2, expires_at=expired_at)
        )
        await session.commit()


async def add_delivery(
    sessions: Sessions, s: Setup, driver: User, reference: str, *, at: datetime
) -> None:
    """Give an order an arrival and a code proof, both with GPS, dated ``at``."""
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        assignment = await session.scalar(select(Assignment).where(Assignment.order_id == order.id))
        assert assignment is not None
        attempt = DeliveryAttempt(
            assignment_id=assignment.id,
            order_id=order.id,
            arrived_at=at,
            arrival_location=WKTElement(POINT, srid=4326),
            arrival_accuracy_metres=12.0,
            unloading_completed_at=at,
            recorded_by=driver.id,
            created_at=at,
            updated_at=at,
        )
        code = DeliveryCode(
            order_id=order.id,
            code_hash="b" * 64,
            issued_at=at,
            expires_at=at + timedelta(minutes=10),
            used_at=at + timedelta(minutes=1),
            sms_status=SmsStatus.ACCEPTED,
            issued_by=driver.id,
            created_at=at,
            updated_at=at,
        )
        session.add_all([attempt, code])
        await session.flush()
        session.add(
            DeliveryProof(
                assignment_id=assignment.id,
                order_id=order.id,
                delivery_attempt_id=attempt.id,
                delivered_litres=1200,
                unloading_confirmed=True,
                delivered_at=at,
                method=AcknowledgementMethod.DELIVERY_CODE,
                delivery_code_id=code.id,
                location=WKTElement(POINT, srid=4326),
                location_accuracy_metres=8.0,
                recorded_by=driver.id,
                created_at=at,
                updated_at=at,
            )
        )
        await session.commit()


async def gps_points(sessions: Sessions, reference: str) -> list[object]:
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        attempts = await session.scalars(
            select(DeliveryAttempt.arrival_location).where(DeliveryAttempt.order_id == order.id)
        )
        proofs = await session.scalars(
            select(DeliveryProof.location).where(DeliveryProof.order_id == order.id)
        )
        return [point for point in [*attempts, *proofs] if point is not None]


async def add_open_hold(sessions: Sessions, s: Setup, reference: str) -> None:
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        session.add(
            OrderException(
                order_id=order.id,
                category=ExceptionCategory.UNSAFE_ACCESS,
                note="Gate locked",
                hold_kind=HoldKind.UNSAFE_STOP,
                reported_by=s.admin.id,
            )
        )
        await session.commit()


async def reload_user(sessions: Sessions, user_id: uuid.UUID) -> User | None:
    async with sessions() as session:
        return await session.get(User, user_id)


async def anonymize(sessions: Sessions, s: Setup, *, apply: bool) -> service.AnonymizeResult:
    async with sessions() as session:
        return await service.anonymize_customer(
            session, actor=s.admin, customer_phone=s.customer.phone, now=REVIEW_NOW, apply=apply
        )


def test_anonymize_is_refused_while_an_order_is_open(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        failed = await finished_job(sessions, s, driver, order_status=OrderStatus.FAILED)
        delivered = await finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)
        await add_open_hold(sessions, s, delivered)

        with pytest.raises(service.CustomerNotReady) as refused:
            await anonymize(sessions, s, apply=True)
        assert sorted(refused.value.blockers) == sorted(
            [f"{failed}: failed", f"{delivered}: open hold or review"]
        )
        unchanged = await reload_user(sessions, s.customer.id)
        assert unchanged is not None
        assert (unchanged.phone, unchanged.is_active) == (s.customer.phone, True)

    run(scenario)


def test_anonymize_dry_run_saves_nothing_and_apply_removes_the_details(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        delivered = await finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)
        cancelled = await finished_job(sessions, s, driver, order_status=OrderStatus.CANCELLED)
        await add_delivery(sessions, s, driver, delivered, at=OLD)
        await add_codes_and_session(sessions, s.customer, expired_at=datetime.now(UTC))
        original_phone = s.customer.phone

        dry = await anonymize(sessions, s, apply=False)
        assert (dry.orders_anonymized, dry.gps_points_cleared, dry.applied) == (2, 2, False)
        assert dry.notes_to_review == 0
        still = await reload_user(sessions, s.customer.id)
        assert still is not None and still.phone == original_phone
        assert len(await gps_points(sessions, delivered)) == 2

        done = await anonymize(sessions, s, apply=True)
        assert (done.customer_id, done.orders_anonymized, done.gps_points_cleared) == (
            s.customer.id,
            2,
            2,
        )

        async with sessions() as session:
            user = await session.get(User, s.customer.id)
            assert user is not None
            assert user.name == "Deleted customer"
            assert user.phone.startswith("+0") and len(user.phone) == 16
            assert (user.is_active, user.phone_verified_at) == (False, None)
            for table in (UserSession, PhoneVerification):
                left = await session.scalars(select(table).where(table.user_id == user.id))
                assert list(left) == []
            for reference in (delivered, cancelled):
                order = await session.scalar(select(Order).where(Order.reference == reference))
                assert order is not None
                assert (order.contact_name, order.contact_phone, order.delivery_address) == (
                    "Deleted",
                    "+0" + "0" * 14,
                    "Deleted",
                )
                assert (order.landmark, order.delivery_instructions) == (None, None)
                assert order.status in {OrderStatus.DELIVERED, OrderStatus.CANCELLED}
            audit = list(
                await session.scalars(select(AuditLog).where(AuditLog.target_id == user.id))
            )
        assert [(row.action, row.details) for row in audit] == [
            (
                "customer_anonymized",
                {
                    "orders_anonymized": 2,
                    "gps_points_cleared": 2,
                    "addresses_removed": 0,
                    "support_messages_removed": 0,
                    "resolution_notes_removed": 0,
                    "notifications_deleted": 0,
                },
            )
        ]
        assert await gps_points(sessions, delivered) == []

        # The old phone no longer identifies an account; sign-in is impossible.
        with pytest.raises(APIError):
            async with sessions() as session:
                await auth_service.authenticate(session, phone=original_phone, password="unused")

        # The phone is free again; the account is gone from customer lookups.
        with pytest.raises(LookupError):
            await anonymize(sessions, s, apply=True)

    run(scenario)


def test_correct_name_changes_the_name_and_audits_without_names(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        async with sessions() as session:
            customer_id = await service.correct_customer_name(
                session, actor=s.admin, customer_phone=s.customer.phone, name="Corrected Name"
            )
        assert customer_id == s.customer.id
        async with sessions() as session:
            user = await session.get(User, s.customer.id)
            assert user is not None and user.name == "Corrected Name"
            audit = list(
                await session.scalars(select(AuditLog).where(AuditLog.target_id == user.id))
            )
        assert [(row.action, row.details) for row in audit] == [("account_name_corrected", {})]

        async with sessions() as session:
            with pytest.raises(LookupError):
                await service.correct_customer_name(
                    session, actor=s.admin, customer_phone=s.admin.phone, name="Staff"
                )

    run(scenario)


def test_retention_review_dry_run_then_apply_then_nothing_left(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        await backdate_user(sessions, s.customer, OLD - timedelta(days=60))
        await add_codes_and_session(sessions, s.customer, expired_at=OLD)

        # Never verified: one due (created over 30 days before REVIEW_NOW), one not yet.
        due = await add_user(sessions, created, UserRole.CUSTOMER)
        await backdate_user(sessions, due, REVIEW_NOW - timedelta(days=31))
        recent = await add_user(sessions, created, UserRole.CUSTOMER)
        await backdate_user(sessions, recent, REVIEW_NOW - timedelta(days=29))

        # Finished in 2017: due for anonymizing (3 years) and its GPS for clearing.
        old_order = await finished_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DELIVERED,
            events=[(OrderStatus.DELIVERED, datetime(2017, 5, 1, tzinfo=UTC))],
        )
        await add_delivery(sessions, s, driver, old_order, at=datetime(2017, 5, 1, tzinfo=UTC))
        # Delivered in 2020: GPS due (90 days), order kept (under 3 years).
        recent_order = await finished_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DELIVERED,
            events=[(OrderStatus.DELIVERED, OLD)],
        )
        await add_delivery(sessions, s, driver, recent_order, at=OLD)
        # Disputed in 2020: GPS kept as evidence.
        disputed = await finished_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.DISPUTED,
            events=[(OrderStatus.DISPUTED, OLD)],
        )
        await add_delivery(sessions, s, driver, disputed, at=OLD)

        async def review(apply: bool) -> service.ReviewResult:
            async with sessions() as session:
                return await service.retention_review(
                    session, actor=s.admin, now=REVIEW_NOW, apply=apply
                )

        dry = await review(apply=False)
        assert dry.applied is False
        assert dry.phone_codes_cleared >= 1 and dry.delivery_codes_cleared >= 3
        assert dry.sessions_deleted >= 1 and dry.unverified_accounts_deleted >= 1
        assert dry.gps_points_cleared >= 4 and dry.orders_anonymized >= 1
        assert await reload_user(sessions, due.id) is not None
        assert len(await gps_points(sessions, recent_order)) == 2

        applied = await review(apply=True)
        assert applied == dry.__class__(**{**dry.__dict__, "applied": True})

        async with sessions() as session:
            codes = await session.scalars(
                select(PhoneVerification.code_hash).where(
                    PhoneVerification.user_id == s.customer.id
                )
            )
            assert list(codes) == [""]  # row kept, hash gone
            sessions_left = await session.scalars(
                select(UserSession).where(UserSession.user_id == s.customer.id)
            )
            assert list(sessions_left) == []
            delivery_hashes = await session.scalars(
                select(DeliveryCode.code_hash)
                .join(Order, Order.id == DeliveryCode.order_id)
                .where(Order.customer_id == s.customer.id)
            )
            assert set(delivery_hashes) == {""}
            proofs = await session.scalars(
                select(DeliveryProof.delivery_code_id)
                .join(Order, Order.id == DeliveryProof.order_id)
                .where(Order.customer_id == s.customer.id)
            )
            assert all(code_id is not None for code_id in proofs)  # proofs intact
            old = await session.scalar(select(Order).where(Order.reference == old_order))
            kept = await session.scalar(select(Order).where(Order.reference == recent_order))
            assert old is not None and old.delivery_address == "Deleted"
            assert kept is not None and kept.delivery_address != "Deleted"
            audit = await session.scalar(
                select(AuditLog).where(
                    AuditLog.actor_id == s.admin.id, AuditLog.action == "retention_review_applied"
                )
            )
        assert audit is not None and audit.details["orders_anonymized"] == applied.orders_anonymized
        assert await reload_user(sessions, due.id) is None
        assert await reload_user(sessions, recent.id) is not None
        assert await reload_user(sessions, s.customer.id) is not None  # verified-less, has orders
        assert await gps_points(sessions, old_order) == []
        assert await gps_points(sessions, recent_order) == []
        assert len(await gps_points(sessions, disputed)) == 2

        again = await review(apply=True)
        assert again == service.ReviewResult(0, 0, 0, 0, 0, 0, 0, 0, 0, applied=True)

    run(scenario)


async def set_payment(
    sessions: Sessions,
    reference: str,
    status: PaymentStatus,
    *,
    outstanding: int = 0,
    overpaid: int = 0,
) -> Order:
    async with sessions() as session:
        await session.execute(
            update(Order)
            .where(Order.reference == reference)
            .values(
                payment_method=PaymentMethod.PAY_ON_DELIVERY,
                payment_status=status,
                outstanding_balance_minor_units=outstanding,
                overpaid_minor_units=overpaid,
            )
        )
        await session.commit()
        order = await session.scalar(select(Order).where(Order.reference == reference))
    assert order is not None
    return order


async def add_cash(
    sessions: Sessions,
    s: Setup,
    driver: User,
    reference: str,
    status: CashCollectionStatus,
    *,
    note: str | None = None,
) -> uuid.UUID:
    """A cash collection in ``status``, with the received and reconciled fields it needs."""
    async with sessions() as session:
        order = await session.scalar(select(Order).where(Order.reference == reference))
        assert order is not None
        assignment = await session.scalar(select(Assignment).where(Assignment.order_id == order.id))
        assert assignment is not None
        received = status in {CashCollectionStatus.REMITTED, CashCollectionStatus.RECONCILED}
        remittance_id = None
        if received:
            remittance = CashRemittance(
                driver_id=driver.id,
                recorded_minor_units=100_000,
                counted_minor_units=100_000,
                difference_minor_units=0,
                received_by=s.admin.id,
                remitted_at=OLD,
            )
            session.add(remittance)
            await session.flush()
            remittance_id = remittance.id
        reconciled = status is CashCollectionStatus.RECONCILED
        collection = CashCollection(
            order_id=order.id,
            driver_id=driver.id,
            assignment_id=assignment.id,
            amount_minor_units=100_000,
            note=note,
            status=status,
            collected_at=OLD,
            remittance_due_at=OLD + timedelta(hours=8),
            remittance_id=remittance_id,
            remitted_at=OLD if received else None,
            received_by=s.admin.id if received else None,
            reconciled_at=OLD if reconciled else None,
            reconciled_by=s.admin.id if reconciled else None,
        )
        session.add(collection)
        await session.commit()
        return collection.id


def test_anonymize_refuses_unsettled_cash_and_warns_on_outside_balances(
    created: Created,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)

        def delivered() -> object:
            return finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)

        not_recorded = await delivered()
        await set_payment(sessions, not_recorded, PaymentStatus.PENDING_COLLECTION)
        with_driver = await delivered()
        await set_payment(sessions, with_driver, PaymentStatus.PENDING_COLLECTION)
        with_driver_cash = await add_cash(
            sessions, s, driver, with_driver, CashCollectionStatus.COLLECTED
        )
        part_paid = await delivered()
        await set_payment(sessions, part_paid, PaymentStatus.PARTIALLY_PAID, outstanding=50_000)
        await add_cash(
            sessions, s, driver, part_paid, CashCollectionStatus.RECONCILED, note="Paid half"
        )
        overpaid = await delivered()
        await set_payment(sessions, overpaid, PaymentStatus.PAID, overpaid=20_000)
        await add_cash(sessions, s, driver, overpaid, CashCollectionStatus.RECONCILED)
        # Cancelled after confirmation: still pending_collection, but no cash can exist.
        cancelled = await finished_job(sessions, s, driver, order_status=OrderStatus.CANCELLED)
        await set_payment(sessions, cancelled, PaymentStatus.PENDING_COLLECTION)

        with pytest.raises(service.CustomerNotReady) as refused:
            await anonymize(sessions, s, apply=False)
        assert sorted(refused.value.blockers) == sorted(
            [f"{not_recorded}: cash not recorded", f"{with_driver}: cash collected"]
        )

        # Settle both in the app: the cash is recorded and reconciled.
        await add_cash(sessions, s, driver, not_recorded, CashCollectionStatus.RECONCILED)
        await set_payment(sessions, not_recorded, PaymentStatus.PAID)
        async with sessions() as session:
            # One statement: the CHECKs tie the status to these fields.
            remittance = CashRemittance(
                driver_id=driver.id,
                recorded_minor_units=100_000,
                counted_minor_units=100_000,
                difference_minor_units=0,
                received_by=s.admin.id,
                remitted_at=OLD,
            )
            session.add(remittance)
            await session.flush()
            await session.execute(
                update(CashCollection)
                .where(CashCollection.id == with_driver_cash)
                .values(
                    status=CashCollectionStatus.RECONCILED,
                    remittance_id=remittance.id,
                    remitted_at=OLD,
                    received_by=s.admin.id,
                    reconciled_at=OLD,
                    reconciled_by=s.admin.id,
                )
            )
            await session.commit()
        await set_payment(sessions, with_driver, PaymentStatus.PAID)

        result = await anonymize(sessions, s, apply=False)
        assert result.cash_warnings == sorted(
            [
                f"{part_paid}: part paid, ₦500.00 outstanding; "
                "check the balance record kept outside the app (F9)",
                f"{overpaid}: overpaid by ₦200.00; "
                "check the refund record kept outside the app (F7)",
            ]
        )
        assert result.notes_to_review == 1  # the driver's cash note
        assert result.orders_anonymized == 5

    run(scenario)


async def add_saved_address(sessions: Sessions, customer: User) -> None:
    """One saved address in a new zone, as ``POST /me/addresses`` would store it."""
    async with sessions() as session:
        zone = ServiceZone(
            name=f"Sample zone {uuid.uuid4().hex[:8]}",
            is_active=True,
            centre=WKTElement(POINT, srid=4326),
        )
        session.add(zone)
        await session.flush()
        ZONE_IDS.append(zone.id)
        session.add(
            CustomerAddress(
                customer_id=customer.id,
                zone_id=zone.id,
                label="Home",
                address="12 Sample Close, Enugu",
                is_default=True,
            )
        )
        await session.commit()


async def addresses_of(sessions: Sessions, customer_id: uuid.UUID) -> list[CustomerAddress]:
    async with sessions() as session:
        rows = await session.scalars(
            select(CustomerAddress).where(CustomerAddress.customer_id == customer_id)
        )
        return list(rows)


def test_anonymize_removes_saved_addresses(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        await add_saved_address(sessions, s.customer)

        dry = await anonymize(sessions, s, apply=False)
        assert dry.addresses_removed == 1
        assert len(await addresses_of(sessions, s.customer.id)) == 1

        done = await anonymize(sessions, s, apply=True)
        assert done.addresses_removed == 1
        assert await addresses_of(sessions, s.customer.id) == []

    run(scenario)


def test_review_anonymizes_unverified_accounts_that_audit_rows_name(created: Created) -> None:
    """An account with audit rows is anonymized, not deleted (#82, technical lead).

    Deleting it would break ``audit_logs.actor_id`` (RESTRICT) and fail the
    whole review. Either way its saved addresses go.
    """

    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        # Never verified, due, with an address and an audit row of its own
        # (it saved the address).
        audited = await add_user(sessions, created, UserRole.CUSTOMER)
        await backdate_user(sessions, audited, REVIEW_NOW - timedelta(days=31))
        await add_saved_address(sessions, audited)
        async with sessions() as session:
            session.add(
                AuditLog(
                    actor_id=audited.id,
                    action="customer_address_added",
                    target_type="customer_address",
                    target_id=uuid.uuid4(),
                    details={},
                    created_at=REVIEW_NOW - timedelta(days=31),
                )
            )
            await session.commit()
        # Never verified, due, with an address but no audit row: deleted.
        plain = await add_user(sessions, created, UserRole.CUSTOMER)
        await backdate_user(sessions, plain, REVIEW_NOW - timedelta(days=31))
        await add_saved_address(sessions, plain)

        async def review() -> service.ReviewResult:
            async with sessions() as session:
                return await service.retention_review(
                    session, actor=s.admin, now=REVIEW_NOW, apply=True
                )

        result = await review()
        assert result.unverified_accounts_deleted >= 1
        assert result.unverified_accounts_anonymized == 1

        assert await reload_user(sessions, plain.id) is None
        kept = await reload_user(sessions, audited.id)
        assert kept is not None
        assert (kept.name, kept.is_active) == ("Deleted customer", False)
        assert kept.phone.startswith("+0")
        assert await addresses_of(sessions, audited.id) == []

        # A second run finds the anonymized account and leaves it alone.
        again = await review()
        assert again.unverified_accounts_anonymized == 0
        assert again.unverified_accounts_deleted == 0

    run(scenario)


async def add_support_request(
    sessions: Sessions,
    customer: User,
    *,
    resolved_at: datetime | None = None,
    message: str = "The water has not arrived yet.",
    resolution_note: str | None = None,
) -> uuid.UUID:
    async with sessions() as session:
        request = SupportRequest(
            reference=customer_requests.new_reference(customer_requests.SUPPORT_PREFIX),
            user_id=customer.id,
            type=SupportRequestType.LATE,
            message=message,
            status=SupportRequestStatus.RESOLVED if resolved_at else SupportRequestStatus.OPEN,
            idempotency_key=uuid.uuid4(),
            resolved_at=resolved_at,
            resolution_note=resolution_note,
            created_at=(resolved_at or OLD) - timedelta(days=1),
        )
        session.add(request)
        await session.commit()
        return request.id


async def add_deletion_request(sessions: Sessions, customer: User) -> DeletionRequest:
    async with sessions() as session:
        request, _ = await customer_requests.request_deletion(
            session, customer, reason="Moving away"
        )
    return request


async def exists(sessions: Sessions, model: type, row_id: uuid.UUID) -> bool:
    async with sessions() as session:
        return await session.get(model, row_id) is not None


def test_anonymize_removes_request_texts_and_notifications(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        support_id = await add_support_request(sessions, s.customer)
        # A resolved request's staff note can name the customer (#117).
        resolved_id = await add_support_request(
            sessions,
            s.customer,
            resolved_at=OLD + timedelta(days=2),
            resolution_note="Called Ngozi at 12 Sample Close: delivered in full.",
        )
        deletion = await add_deletion_request(sessions, s.customer)
        async with sessions() as session:
            session.add(
                Notification(user_id=s.customer.id, kind="delivered", title="Delivered", body="x")
            )
            await session.commit()

        done = await anonymize(sessions, s, apply=True)
        assert (done.support_messages_removed, done.notifications_deleted) == (2, 1)
        assert done.resolution_notes_removed == 1

        async with sessions() as session:
            support = await session.get(SupportRequest, support_id)
            resolved = await session.get(SupportRequest, resolved_id)
            request = await session.get(DeletionRequest, deletion.id)
            left = list(
                await session.scalars(
                    select(Notification).where(Notification.user_id == s.customer.id)
                )
            )
        assert support is not None and support.message == "Removed at the customer's request."
        # The open request had no note and still has none; the resolved one's
        # note is replaced, so the admin view keeps a note string.
        assert support.resolution_note is None
        assert resolved is not None
        assert (resolved.message, resolved.resolution_note) == (
            "Removed at the customer's request.",
            "Removed at the customer's request.",
        )
        assert resolved.status is SupportRequestStatus.RESOLVED
        assert request is not None and request.reason is None
        assert request.status is DeletionRequestStatus.RECEIVED  # set separately
        assert left == []

    run(scenario)


def test_review_deletes_complaints_resolved_over_three_years_ago(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        old = await add_support_request(
            sessions, s.customer, resolved_at=datetime(2018, 1, 5, tzinfo=UTC)
        )
        recent = await add_support_request(
            sessions, s.customer, resolved_at=datetime(2019, 1, 5, tzinfo=UTC)
        )
        still_open = await add_support_request(sessions, s.customer)
        # A never-verified account without orders or audit rows: deleted
        # with its support request.
        due = await add_user(sessions, created, UserRole.CUSTOMER)
        await backdate_user(sessions, due, REVIEW_NOW - timedelta(days=31))
        due_request = await add_support_request(sessions, due)

        async with sessions() as session:
            result = await service.retention_review(
                session, actor=s.admin, now=REVIEW_NOW, apply=True
            )
        assert result.support_requests_deleted == 1
        assert not await exists(sessions, SupportRequest, old)
        assert await exists(sessions, SupportRequest, recent)
        assert await exists(sessions, SupportRequest, still_open)
        assert await reload_user(sessions, due.id) is None
        assert not await exists(sessions, SupportRequest, due_request)

    run(scenario)


async def add_handled_request(
    sessions: Sessions,
    customer: User,
    status: DeletionRequestStatus,
    *,
    at: datetime | None = None,
) -> uuid.UUID:
    """A deletion request in ``status``; ``at`` is when it was completed or refused."""
    async with sessions() as session:
        request = DeletionRequest(
            reference=customer_requests.new_reference(customer_requests.DELETION_PREFIX),
            user_id=customer.id,
            status=status,
            acknowledge_by=(at or OLD).date(),
            completed_at=at if status is DeletionRequestStatus.COMPLETED else None,
            refused_at=at if status is DeletionRequestStatus.REFUSED else None,
            refusal_reason="Open dispute" if status is DeletionRequestStatus.REFUSED else None,
            created_at=(at or OLD) - timedelta(days=5),
        )
        session.add(request)
        await session.commit()
        return request.id


def test_review_deletes_deletion_requests_handled_over_three_years_ago(created: Created) -> None:
    # #118: kept 3 years after completion or refusal; open ones never deleted.
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        cutoff = REVIEW_NOW.replace(year=REVIEW_NOW.year - 3)
        just_outside = cutoff - timedelta(days=1)
        just_inside = cutoff + timedelta(days=1)
        completed_old = await add_handled_request(
            sessions, s.customer, DeletionRequestStatus.COMPLETED, at=just_outside
        )
        refused_old = await add_handled_request(
            sessions, s.customer, DeletionRequestStatus.REFUSED, at=just_outside
        )
        completed_recent = await add_handled_request(
            sessions, s.customer, DeletionRequestStatus.COMPLETED, at=just_inside
        )
        refused_recent = await add_handled_request(
            sessions, s.customer, DeletionRequestStatus.REFUSED, at=just_inside
        )
        # Open requests, however old: at most one per customer.
        other = await add_user(sessions, created, UserRole.CUSTOMER)
        received = await add_handled_request(sessions, s.customer, DeletionRequestStatus.RECEIVED)
        acknowledged = await add_handled_request(
            sessions, other, DeletionRequestStatus.ACKNOWLEDGED
        )

        async with sessions() as session:
            dry = await service.retention_review(
                session, actor=s.admin, now=REVIEW_NOW, apply=False
            )
        assert dry.deletion_requests_deleted == 2
        assert await exists(sessions, DeletionRequest, completed_old)  # dry run saves nothing

        async with sessions() as session:
            result = await service.retention_review(
                session, actor=s.admin, now=REVIEW_NOW, apply=True
            )
        assert result.deletion_requests_deleted == 2
        assert not await exists(sessions, DeletionRequest, completed_old)
        assert not await exists(sessions, DeletionRequest, refused_old)
        for kept in (completed_recent, refused_recent, received, acknowledged):
            assert await exists(sessions, DeletionRequest, kept)
        async with sessions() as session:
            audit = await session.scalar(
                select(AuditLog)
                .where(
                    AuditLog.actor_id == s.admin.id, AuditLog.action == "retention_review_applied"
                )
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
        assert audit is not None and audit.details["deletion_requests_deleted"] == 2

    run(scenario)


def test_deletion_request_status_follows_the_rules(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        request = await add_deletion_request(sessions, s.customer)

        async def set_status(status: DeletionRequestStatus, reason: str | None = None) -> None:
            async with sessions() as session:
                await service.set_deletion_request_status(
                    session,
                    actor=s.admin,
                    reference=request.reference,
                    status=status,
                    reason=reason,
                    now=datetime.now(UTC),
                )

        async def status_now() -> DeletionRequestStatus:
            async with sessions() as session:
                row = await session.get(DeletionRequest, request.id)
                assert row is not None
                return row.status

        # received → completed skips acknowledging.
        with pytest.raises(DeletionStatusRefused):
            await set_status(DeletionRequestStatus.COMPLETED)
        await set_status(DeletionRequestStatus.ACKNOWLEDGED)
        assert await status_now() is DeletionRequestStatus.ACKNOWLEDGED
        # Not completed until the account is really anonymized.
        with pytest.raises(DeletionStatusRefused, match="not anonymized"):
            await set_status(DeletionRequestStatus.COMPLETED)
        await anonymize(sessions, s, apply=True)
        await set_status(DeletionRequestStatus.COMPLETED)
        assert await status_now() is DeletionRequestStatus.COMPLETED
        # Final.
        with pytest.raises(DeletionStatusRefused):
            await set_status(DeletionRequestStatus.REFUSED, "Changed our mind")

        async with sessions() as session:
            row = await session.get(DeletionRequest, request.id)
            actions = list(
                await session.scalars(
                    select(AuditLog.action)
                    .where(AuditLog.target_id == request.id, AuditLog.actor_id == s.admin.id)
                    .order_by(AuditLog.created_at)
                )
            )
        assert row is not None and row.handled_by == s.admin.id
        assert row.acknowledged_at is not None and row.completed_at is not None
        assert actions == ["deletion_request_acknowledged", "deletion_request_completed"]

        with pytest.raises(LookupError):
            async with sessions() as session:
                await service.set_deletion_request_status(
                    session,
                    actor=s.admin,
                    reference="DR-NOTHING0",
                    status=DeletionRequestStatus.ACKNOWLEDGED,
                    reason=None,
                    now=datetime.now(UTC),
                )

    run(scenario)


def test_a_refusal_needs_a_reason_and_frees_the_customer_to_ask_again(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        request = await add_deletion_request(sessions, s.customer)

        async def refuse(reason: str | None) -> None:
            async with sessions() as session:
                await service.set_deletion_request_status(
                    session,
                    actor=s.admin,
                    reference=request.reference,
                    status=DeletionRequestStatus.REFUSED,
                    reason=reason,
                    now=datetime.now(UTC),
                )

        with pytest.raises(DeletionStatusRefused, match="reason"):
            await refuse(None)
        await refuse("Open dispute on an order")
        async with sessions() as session:
            row = await session.get(DeletionRequest, request.id)
            with pytest.raises(APIError):
                await customer_requests.get_open_deletion_request(session, s.customer)
            again, created_now = await customer_requests.request_deletion(
                session, s.customer, reason=None
            )
        assert row is not None
        assert (row.status, row.refusal_reason) == (
            DeletionRequestStatus.REFUSED,
            "Open dispute on an order",
        )
        assert created_now is True and again.id != request.id

    run(scenario)


# --- Riders and drivers (#119) ---------------------------------------------------------


async def add_partner_profile(sessions: Sessions, driver: User) -> uuid.UUID:
    """An approved tanker profile with a plate, capacity, a zone and transfer methods."""
    async with sessions() as session:
        zone = ServiceZone(
            name=f"Sample zone {uuid.uuid4().hex[:8]}",
            is_active=True,
            centre=WKTElement(POINT, srid=4326),
        )
        session.add(zone)
        await session.flush()
        ZONE_IDS.append(zone.id)
        profile = DriverProfile(
            user_id=driver.id,
            approval_status=ApprovalStatus.APPROVED,
            delivery_type=PartnerType.TANKER,
            plate="ENU-456-CD",
            declared_capacity_gallons=4000,
            transfer_methods=["ground", "overhead"],
            is_available=True,
            new_order_alerts=False,
        )
        session.add(profile)
        await session.flush()
        session.add(DriverServiceZone(driver_profile_id=profile.id, zone_id=zone.id))
        await session.commit()
        return profile.id


async def anonymize_partner(
    sessions: Sessions, s: Setup, driver: User, *, apply: bool
) -> service.PartnerAnonymizeResult:
    async with sessions() as session:
        return await service.anonymize_partner(
            session, actor=s.admin, partner_phone=driver.phone, now=REVIEW_NOW, apply=apply
        )


def test_anonymize_partner_is_refused_while_anything_is_open(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        live = await add_job(sessions, s, driver, order_status=OrderStatus.EN_ROUTE)
        held = await finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)
        await add_open_hold(sessions, s, held)
        unsettled = await finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)
        await add_cash(sessions, s, driver, unsettled, CashCollectionStatus.REMITTED)
        disputed = await finished_job(sessions, s, driver, order_status=OrderStatus.DISPUTED)

        with pytest.raises(service.PartnerNotReady) as refused:
            await anonymize_partner(sessions, s, driver, apply=True)
        assert sorted(refused.value.blockers) == sorted(
            [
                f"{live}: job accepted",
                f"{held}: open hold or review",
                f"{unsettled}: cash remitted",
                f"{disputed}: disputed",
            ]
        )
        stored = await reload_user(sessions, driver.id)
        assert stored is not None and stored.phone == driver.phone and stored.is_active

        # A customer's phone is not a partner's.
        with pytest.raises(LookupError):
            async with sessions() as session:
                await service.anonymize_partner(
                    session,
                    actor=s.admin,
                    partner_phone=s.customer.phone,
                    now=REVIEW_NOW,
                    apply=True,
                )

    run(scenario)


def test_anonymize_partner_removes_their_details_and_keeps_the_records(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        profile_id = await add_partner_profile(sessions, driver)
        done_job = await finished_job(sessions, s, driver, order_status=OrderStatus.DELIVERED)
        await add_delivery(sessions, s, driver, done_job, at=OLD)
        cash_id = await add_cash(sessions, s, driver, done_job, CashCollectionStatus.RECONCILED)
        declined = await add_job(
            sessions,
            s,
            driver,
            order_status=OrderStatus.CONFIRMED,
            assignment_status=AssignmentStatus.DECLINED,
            ended_at=OLD,
        )
        async with sessions() as session:
            order = await session.scalar(select(Order).where(Order.reference == declined))
            assert order is not None
            await session.execute(
                update(Assignment)
                .where(Assignment.order_id == order.id)
                .values(decline_note="My wife is ill at 12 Sample Close")
            )
            done = await session.scalar(select(Order).where(Order.reference == done_job))
            assert done is not None
            session.add(
                OrderException(
                    order_id=done.id,
                    category=ExceptionCategory.RUNNING_LATE,
                    note="Traffic at Ogui Road",
                    reported_by=driver.id,
                )
            )
            session.add(Notification(user_id=driver.id, kind="assigned", title="New job", body="x"))
            await session.commit()
        await add_codes_and_session(sessions, driver, expired_at=REVIEW_NOW + timedelta(days=1))

        dry = await anonymize_partner(sessions, s, driver, apply=False)
        assert (dry.applied, dry.zones_removed, dry.decline_notes_removed) == (False, 1, 1)
        assert (dry.gps_points_cleared, dry.notifications_deleted, dry.notes_to_review) == (2, 1, 1)
        stored = await reload_user(sessions, driver.id)
        assert stored is not None and stored.phone == driver.phone  # nothing saved

        done_result = await anonymize_partner(sessions, s, driver, apply=True)
        assert done_result.applied is True
        async with sessions() as session:
            user = await session.get(User, driver.id)
            profile = await session.get(DriverProfile, profile_id)
            zones = list(
                await session.scalars(
                    select(DriverServiceZone).where(
                        DriverServiceZone.driver_profile_id == profile_id
                    )
                )
            )
            notes = list(
                await session.scalars(
                    select(Assignment.decline_note).where(Assignment.driver_user_id == driver.id)
                )
            )
            left = list(
                await session.scalars(select(Notification).where(Notification.user_id == driver.id))
            )
            cash = await session.get(CashCollection, cash_id)
            jobs = list(
                await session.scalars(
                    select(Assignment).where(Assignment.driver_user_id == driver.id)
                )
            )
            incident = await session.scalar(
                select(OrderException).where(OrderException.reported_by == driver.id)
            )
            audit = list(
                await session.scalars(select(AuditLog).where(AuditLog.target_id == driver.id))
            )
            sessions_left = list(
                await session.scalars(select(UserSession).where(UserSession.user_id == driver.id))
            )
        assert user is not None
        assert (user.name, user.is_active) == ("Former rider or driver", False)
        assert user.phone.startswith("+0") and user.phone != driver.phone
        assert sessions_left == []
        assert profile is not None
        assert (profile.plate, profile.declared_capacity_gallons, profile.is_available) == (
            None,
            None,
            False,
        )
        assert (profile.transfer_methods, profile.new_order_alerts) == ([], True)
        assert profile.approval_status is ApprovalStatus.APPROVED  # kept as a record
        assert zones == []
        assert "Removed at the partner's request." in notes
        assert "My wife is ill at 12 Sample Close" not in notes
        assert await gps_points(sessions, done_job) == []
        assert left == []
        # Kept: the jobs, the cash record and the incident note.
        assert len(jobs) == 2
        assert cash is not None and cash.status is CashCollectionStatus.RECONCILED
        assert incident is not None and incident.note == "Traffic at Ogui Road"
        assert [(row.action, row.details) for row in audit] == [
            (
                "partner_anonymized",
                {
                    "zones_removed": 1,
                    "decline_notes_removed": 1,
                    "gps_points_cleared": 2,
                    "notifications_deleted": 1,
                    "reasons_cleared": 0,
                },
            )
        ]
        # The old phone no longer finds a partner.
        with pytest.raises(LookupError):
            await anonymize_partner(sessions, s, driver, apply=True)

    run(scenario)


def test_anonymize_partner_replaces_the_reasons_on_their_decision_rows_with_a_marker(
    created: Created,
) -> None:
    async def add_audit_row(
        sessions: Sessions,
        s: Setup,
        *,
        action: str,
        target_id: uuid.UUID,
        details: dict[str, object],
    ) -> uuid.UUID:
        async with sessions() as session:
            row = AuditLog(
                actor_id=s.admin.id,
                action=action,
                target_type="driver",
                target_id=target_id,
                details=details,
            )
            session.add(row)
            await session.commit()
            return row.id

    async def details_of(sessions: Sessions, row_id: uuid.UUID) -> dict[str, object]:
        async with sessions() as session:
            row = await session.get(AuditLog, row_id)
            assert row is not None
            return row.details

    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        other = await add_user(sessions, created, UserRole.DRIVER)
        await add_partner_profile(sessions, driver)
        suspended = await add_audit_row(
            sessions,
            s,
            action="driver_suspended",
            target_id=driver.id,
            details={"reason": "Papers expired for Sample Driver", "vehicle_profile_id": "v-1"},
        )
        deactivated = await add_audit_row(
            sessions,
            s,
            action="driver_deactivated",
            target_id=driver.id,
            details={"reason": "Left the pilot"},
        )
        no_reason = await add_audit_row(
            sessions, s, action="driver_activated", target_id=driver.id, details={}
        )
        not_a_decision = await add_audit_row(
            sessions,
            s,
            action="driver_note_added",
            target_id=driver.id,
            details={"reason": "Not one of the four decision actions"},
        )
        someone_elses = await add_audit_row(
            sessions,
            s,
            action="driver_suspended",
            target_id=other.id,
            details={"reason": "Another driver's reason"},
        )

        dry = await anonymize_partner(sessions, s, driver, apply=False)
        assert (dry.applied, dry.reasons_cleared) == (False, 2)
        assert (await details_of(sessions, suspended))["reason"] == (
            "Papers expired for Sample Driver"
        )

        done = await anonymize_partner(sessions, s, driver, apply=True)
        assert done.reasons_cleared == 2
        # The reason is gone and the marker says so; other keys stay.
        assert await details_of(sessions, suspended) == {
            "vehicle_profile_id": "v-1",
            "reason_removed": True,
        }
        assert await details_of(sessions, deactivated) == {"reason_removed": True}
        # No reason was given, so there is nothing to mark.
        assert await details_of(sessions, no_reason) == {}
        # Rows that are not the four decisions, and other drivers' rows, are untouched.
        assert (await details_of(sessions, not_a_decision))["reason"] == (
            "Not one of the four decision actions"
        )
        assert await details_of(sessions, someone_elses) == {"reason": "Another driver's reason"}
        async with sessions() as session:
            own = await session.scalar(
                select(AuditLog).where(
                    AuditLog.action == "partner_anonymized", AuditLog.target_id == driver.id
                )
            )
        assert own is not None and own.details["reasons_cleared"] == 2

    run(scenario)
