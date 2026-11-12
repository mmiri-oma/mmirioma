"""Order confirmation against a real, migrated database (#113).

Contract: docs/api/deliveries.md, "Order confirmation endpoints" (agreed,
PR #111). Covers the options read; a confirmation's two events in order, the
price snapshot, order fields, audit row and SMS; the SMS failure path
(FR-050); every refusal writing nothing (repeat, unmet checks, field
errors, a failure mid-transaction); T-09 (later changes leave the price
alone); decision 10 (a suspended source does not block assigning); and the
detail and history the screens read.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every row is created here and deleted afterwards.
"""

import secrets
import uuid
from collections.abc import Awaitable, Iterator
from datetime import UTC, date, datetime, timedelta

import psycopg
import pytest
from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.audit import service as audit_service
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User, UserRole
from app.modules.confirmation import service as confirmation
from app.modules.confirmation.schemas import ConfirmationLineRead, OrderConfirmationFields
from app.modules.deliveries import holds
from app.modules.dispatch import service as dispatch_service
from app.modules.dispatch.models import ApprovalStatus, DriverProfile, VehicleProfile
from app.modules.dispatch.schemas import AdminOrderEvent
from app.modules.messaging.sms import MockSmsProvider
from app.modules.orders.models import (
    ConfirmationSmsStatus,
    Order,
    OrderEvent,
    OrderStatus,
    TransitionReason,
)
from app.modules.pricing.models import AgreementMethod, OrderPriceSnapshot
from app.modules.sources.eligibility import EligibilityReason
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from tests import test_deliveries_integration as part1
from tests.test_deliveries_integration import (
    REFERENCE_ALPHABET,
    TEST_DATABASE_URL,
    Created,
    Sessions,
    Setup,
    add_user,
    run,
    setup,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

S = OrderStatus
created = part1.created

# Mon 26 Oct 2026, 2:21 pm in Lagos; the order was sent that morning.
NOW = datetime(2026, 10, 26, 13, 21, tzinfo=UTC)
TODAY = date(2026, 10, 26)
WINDOW_START = datetime(2026, 10, 27, 9, tzinfo=UTC)
WINDOW_END = datetime(2026, 10, 27, 11, tzinfo=UTC)


@pytest.fixture
def vehicle_ids() -> list[uuid.UUID]:
    """Vehicles a test creates; deleted by :func:`delete_own_rows`."""
    return []


@pytest.fixture(autouse=True)
def delete_own_rows(created: Created, vehicle_ids: list[uuid.UUID]) -> Iterator[None]:
    """Delete this module's audit rows and driver profiles before part 1 deletes the users.

    Both reference users (RESTRICT). This fixture depends on ``created``, so
    its teardown runs first. Part 1 deletes events, assignments and orders.
    """
    yield
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        users = (created.user_ids,)
        connection.execute("DELETE FROM audit_logs WHERE actor_id = ANY(%s)", users)
        connection.execute("DELETE FROM driver_profiles WHERE user_id = ANY(%s)", users)
        connection.execute("DELETE FROM vehicle_profiles WHERE id = ANY(%s)", (vehicle_ids,))


async def expect_error(awaitable: Awaitable[object]) -> APIError:
    with pytest.raises(APIError) as caught:
        await awaitable
    return caught.value


async def category(sessions: Sessions, code: str) -> WaterCategory:
    async with sessions() as session:
        row = await session.scalar(select(WaterCategory).where(WaterCategory.code == code))
    assert row is not None
    return row


async def activate(
    sessions: Sessions,
    source_id: uuid.UUID,
    category_id: uuid.UUID,
    *,
    status: ActivationStatus = ActivationStatus.ACTIVATED,
    approved_until: date = date(2027, 1, 30),
) -> None:
    async with sessions() as session:
        session.add(
            WaterSourceCategory(
                source_id=source_id,
                water_category_id=category_id,
                status=status,
                approved_until=approved_until,
                report_reference="LR-0001",
                cost_per_litre_minor_units=150,
                status_reason=None if status is ActivationStatus.ACTIVATED else "Sample reason",
            )
        )
        await session.commit()


async def verify_phone(sessions: Sessions, user: User) -> None:
    async with sessions() as session:
        await session.execute(
            update(User).where(User.id == user.id).values(phone_verified_at=NOW - timedelta(days=3))
        )
        await session.commit()


async def new_order(sessions: Sessions, s: Setup) -> Order:
    """A Request received order, sent this morning, with no source or window."""
    order = Order(
        reference="MO-" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(10)),
        customer_id=s.customer.id,
        idempotency_key=uuid.uuid4(),
        status=S.QUOTE_REQUESTED,
        quantity_litres=2000,
        contact_name="Sample Customer",
        contact_phone="+2348000000001",
        delivery_address="12 Sample Close, Independence Layout, Enugu",
        is_simulated=True,
    )
    sent_at = NOW - timedelta(hours=4)
    async with sessions() as session:
        session.add(order)
        await session.flush()
        # Pinned to the test clock: the confirmation events are written at NOW,
        # so a database-time creation event would sort after them once the
        # real clock passes NOW.
        session.add(
            OrderEvent(
                order_id=order.id,
                to_status=S.QUOTE_REQUESTED,
                actor_id=s.customer.id,
                created_at=sent_at,
            )
        )
        await session.execute(update(Order).where(Order.id == order.id).values(created_at=sent_at))
        await session.commit()
        await session.refresh(order)
    return order


def request(potable: WaterCategory, s: Setup, **changes: object) -> confirmation.ConfirmInput:
    values: dict[str, object] = {
        "expected_status": OrderStatus.QUOTE_REQUESTED,
        "water_category_id": potable.id,
        "source_id": s.source_id,
        "window_start_at": WINDOW_START,
        "window_end_at": WINDOW_END,
        "total_minor_units": 4_500_000,
        "agreement_method": AgreementMethod.PHONE_CALL,
        "agreed_at": NOW - timedelta(minutes=6),
        "note": "Customer asked the driver to call on arrival.",
    }
    values.update(changes)
    return confirmation.ConfirmInput(**values)  # type: ignore[arg-type]


async def ready(sessions: Sessions, created: Created) -> tuple[Setup, WaterCategory, Order]:
    """A verified customer, an activated source and a Request received order."""
    s = await setup(sessions, created)
    potable = await category(sessions, "potable")
    await activate(sessions, s.source_id, potable.id)
    await verify_phone(sessions, s.customer)
    return s, potable, await new_order(sessions, s)


async def confirm(
    sessions: Sessions,
    s: Setup,
    order: Order,
    data: confirmation.ConfirmInput,
    sms: MockSmsProvider,
) -> None:
    async with sessions() as session:
        await confirmation.confirm_order(
            session, reference=order.reference, admin=s.admin, data=data, sms=sms, now=NOW
        )


async def nothing_written(sessions: Sessions, order: Order) -> None:
    """The order is untouched: still Request received, one event, no snapshot."""
    async with sessions() as session:
        fresh = await session.get(Order, order.id)
        assert fresh is not None
        assert fresh.status is S.QUOTE_REQUESTED
        assert (fresh.source_id, fresh.water_category_id, fresh.delivery_window_start_at) == (
            None,
            None,
            None,
        )
        events = await session.scalar(
            select(func.count()).select_from(OrderEvent).where(OrderEvent.order_id == order.id)
        )
        snapshots = await session.scalar(
            select(func.count())
            .select_from(OrderPriceSnapshot)
            .where(OrderPriceSnapshot.order_id == order.id)
        )
        audits = await session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.target_id == order.id)
        )
    assert (events, snapshots, audits) == (1, 0, 0)


# --- Options ---------------------------------------------------------------------------


def test_options_list_eligible_sources_first(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        potable = await category(sessions, "potable")
        suspended = WaterSource(
            name="AAA Suspended Borehole",
            approximate_location="Abakpa",
            kind=WaterSourceKind.BOREHOLE,
        )
        async with sessions() as session:
            session.add(suspended)
            await session.commit()
        created.source_ids.append(suspended.id)
        await activate(sessions, s.source_id, potable.id)
        await activate(sessions, suspended.id, potable.id, status=ActivationStatus.SUSPENDED)
        order = await new_order(sessions, s)

        async with sessions() as session:
            options = await confirmation.confirmation_options(
                session, reference=order.reference, today=TODAY
            )
        by_label = {item.category.label: item for item in options}
        assert {"Potable Water", "Utility Water"} <= set(by_label)
        mine = {s.source_id, suspended.id}
        potable_rows = [o for o in by_label["Potable Water"].sources if o.source.id in mine]
        # Eligible first even though "AAA..." sorts first by name.
        assert [o.source.id for o in potable_rows] == [s.source_id, suspended.id]
        assert [o.reasons for o in potable_rows] == [[], [EligibilityReason.SUSPENDED]]
        utility_rows = [o for o in by_label["Utility Water"].sources if o.source.id in mine]
        assert {tuple(o.reasons) for o in utility_rows} == {(EligibilityReason.NOT_ACTIVATED,)}

        async with sessions() as session:
            error = await expect_error(
                confirmation.confirmation_options(session, reference="MO-0000000000")
            )
        assert (error.status_code, error.code) == (404, "order_not_found")

    run(scenario)


# --- Confirm ----------------------------------------------------------------------------


def test_confirm_writes_both_events_the_snapshot_and_sends_the_sms(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        sms = MockSmsProvider()
        await confirm(sessions, s, order, request(potable, s), sms)

        async with sessions() as session:
            fresh = await session.get(Order, order.id)
            assert fresh is not None
            events = list(
                await session.scalars(
                    select(OrderEvent)
                    .where(OrderEvent.order_id == order.id)
                    .order_by(OrderEvent.created_at, OrderEvent.id)
                )
            )
            snapshot = await session.scalar(
                select(OrderPriceSnapshot).where(OrderPriceSnapshot.order_id == order.id)
            )
            audit = list(
                await session.scalars(select(AuditLog).where(AuditLog.target_id == order.id))
            )
        assert fresh.status is S.CONFIRMED
        assert (fresh.water_category_id, fresh.source_id) == (potable.id, s.source_id)
        assert (fresh.delivery_window_start_at, fresh.delivery_window_end_at) == (
            WINDOW_START,
            WINDOW_END,
        )
        # Row 26 then row 7, by the dispatcher, in that order.
        assert [(e.from_status, e.to_status, e.reason_code) for e in events[1:]] == [
            (S.QUOTE_REQUESTED, S.AWAITING_CONFIRMATION, TransitionReason.MANUAL_QUOTE),
            (S.AWAITING_CONFIRMATION, S.CONFIRMED, None),
        ]
        assert {e.actor_id for e in events[1:]} == {s.admin.id}
        assert events[1].note is None
        assert events[2].note == "Customer asked the driver to call on arrival."
        assert events[2].created_at > events[1].created_at

        assert snapshot is not None
        assert snapshot.event_id == events[2].id
        assert (snapshot.total_minor_units, snapshot.currency, snapshot.is_manual) == (
            4_500_000,
            "NGN",
            True,
        )
        assert (snapshot.water_category_label, snapshot.source_id) == ("Potable Water", s.source_id)
        assert (snapshot.entered_by, snapshot.entered_at) == (s.admin.id, NOW)
        assert snapshot.customer_agreement_method is AgreementMethod.PHONE_CALL

        assert [(a.action, a.actor_id) for a in audit] == [("order_confirmed", s.admin.id)]
        assert audit[0].details == {
            "source_id": str(s.source_id),
            "water_category_id": str(potable.id),
            "manual_quote": True,
        }

        assert [(m.phone, m.text) for m in sms.outbox] == [
            (
                s.customer.phone,
                f"MmiriOma: order {order.reference} is confirmed for Tue 27 Oct 2026, "
                "10:00 am to 12:00 pm. Total N45,000.00, pay cash after unloading. "
                "Help: +234 813 377 4902",
            )
        ]
        assert fresh.confirmation_sms_status is ConfirmationSmsStatus.ACCEPTED
        assert fresh.confirmation_sms_attempted_at == NOW

        # C2: the detail the screens read.
        async with sessions() as session:
            detail = await holds.get_order_detail(session, reference=order.reference)
        fields = OrderConfirmationFields.from_view(
            detail.dispatch.staff_order.order, detail.confirmation
        ).model_dump(mode="json")
        assert fields["water_category"]["label"] == "Potable Water"
        assert fields["source"]["report_reference"] == "LR-0001"
        assert fields["source"]["reasons"] == []
        assert fields["price"]["total_minor_units"] == 4_500_000
        assert fields["price"]["entered_by"] == {"id": str(s.admin.id), "name": s.admin.name}
        assert fields["price"]["customer_agreement"]["method"] == "phone_call"
        assert fields["confirmation_sms"]["status"] == "accepted"

        # H1: newest first; the confirmation line on the row 7 entry only.
        async with sessions() as session:
            entries = await dispatch_service.order_history(session, reference=order.reference)
            lines = await confirmation.confirmation_lines(
                session, {entry.event.id for entry in entries}
            )
        items = [
            AdminOrderEvent.from_entry(entry, lines).model_dump(mode="json") for entry in entries
        ]
        assert [(i["to_status"], i["reason_code"]) for i in items] == [
            ("confirmed", None),
            ("awaiting_confirmation", "manual_quote"),
            ("quote_requested", None),
        ]
        assert items[0]["confirmation"] == ConfirmationLineRead.model_validate(
            {
                "water_category_label": "Potable Water",
                "source_name": "Sample Borehole A",
                "delivery_window": {"start_at": WINDOW_START, "end_at": WINDOW_END},
                "total_minor_units": 4_500_000,
                "manual": True,
            }
        ).model_dump(mode="json")
        assert items[1]["confirmation"] is None and items[2]["confirmation"] is None

    run(scenario)


def test_a_refused_sms_never_undoes_the_confirmation(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        sms = MockSmsProvider(fail=True)
        await confirm(sessions, s, order, request(potable, s), sms)
        async with sessions() as session:
            fresh = await session.get(Order, order.id)
        assert fresh is not None
        assert fresh.status is S.CONFIRMED
        assert fresh.confirmation_sms_status is ConfirmationSmsStatus.NOT_ACCEPTED
        assert sms.outbox == []

    run(scenario)


def test_a_repeat_is_refused_without_a_second_snapshot_or_sms(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        sms = MockSmsProvider()
        await confirm(sessions, s, order, request(potable, s), sms)
        async with sessions() as session:
            error = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=s.admin,
                    data=request(potable, s),
                    sms=sms,
                    now=NOW,
                )
            )
        assert (error.status_code, error.code) == (409, "invalid_order_transition")
        assert error.details == {"from": "confirmed", "to": "confirmed"}
        async with sessions() as session:
            snapshots = await session.scalar(
                select(func.count())
                .select_from(OrderPriceSnapshot)
                .where(OrderPriceSnapshot.order_id == order.id)
            )
        assert (snapshots, len(sms.outbox)) == (1, 1)

    run(scenario)


def test_unmet_checks_write_nothing(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        potable = await category(sessions, "potable")
        # Phone not verified, and the source suspended (BR-10).
        await activate(sessions, s.source_id, potable.id, status=ActivationStatus.SUSPENDED)
        order = await new_order(sessions, s)
        sms = MockSmsProvider()
        async with sessions() as session:
            error = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=s.admin,
                    data=request(potable, s),
                    sms=sms,
                    now=NOW,
                )
            )
        assert (error.status_code, error.code) == (409, "transition_requirements_unmet")
        assert error.details == {"missing": ["phone_verified", "source_eligible"]}
        assert sms.outbox == []
        await nothing_written(sessions, order)

    run(scenario)


def test_t04_an_expired_approval_cannot_be_chosen(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        potable = await category(sessions, "potable")
        await activate(sessions, s.source_id, potable.id, approved_until=TODAY - timedelta(days=1))
        await verify_phone(sessions, s.customer)
        order = await new_order(sessions, s)
        async with sessions() as session:
            error = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=s.admin,
                    data=request(potable, s),
                    sms=MockSmsProvider(),
                    now=NOW,
                )
            )
        assert error.details == {"missing": ["source_eligible"]}
        await nothing_written(sessions, order)

    run(scenario)


def test_field_errors_are_reported_together_and_write_nothing(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        data = request(
            potable,
            s,
            source_id=uuid.uuid4(),
            window_start_at=NOW - timedelta(hours=1),
            window_end_at=NOW + timedelta(hours=1),
            agreed_at=NOW - timedelta(days=1),  # before the order was sent
        )
        async with sessions() as session:
            error = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=s.admin,
                    data=data,
                    sms=MockSmsProvider(),
                    now=NOW,
                )
            )
        assert (error.status_code, error.code) == (422, "validation_error")
        assert [tuple(item["loc"]) for item in error.details] == [
            ("body", "source_id"),
            ("body", "delivery_window", "start_at"),
            ("body", "customer_agreement", "agreed_at"),
        ]
        await nothing_written(sessions, order)

        async with sessions() as session:
            future = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=s.admin,
                    data=request(potable, s, agreed_at=NOW + timedelta(minutes=10)),
                    sms=MockSmsProvider(),
                    now=NOW,
                )
            )
        assert future.details[0]["loc"] == ["body", "customer_agreement", "agreed_at"]

    run(scenario)


def test_a_failure_mid_transaction_rolls_back_both_events(
    created: Created, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)

        def broken(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("Sample failure after both transitions")

        monkeypatch.setattr(audit_service, "record", broken)
        sms = MockSmsProvider()
        with pytest.raises(RuntimeError):
            await confirm(sessions, s, order, request(potable, s), sms)
        assert sms.outbox == []
        await nothing_written(sessions, order)

    run(scenario)


def test_t09_later_changes_leave_the_confirmed_price_alone(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        await confirm(sessions, s, order, request(potable, s), MockSmsProvider())
        async with sessions() as session:
            await session.execute(
                update(WaterSourceCategory)
                .where(WaterSourceCategory.source_id == s.source_id)
                .values(cost_per_litre_minor_units=999)
            )
            await session.execute(
                update(WaterCategory)
                .where(WaterCategory.id == potable.id)
                .values(label="Potable Water (renamed)")
            )
            await session.commit()
        try:
            async with sessions() as session:
                fresh = await session.get(Order, order.id)
                assert fresh is not None
                view = await confirmation.confirmation_view(session, fresh, today=TODAY)
            assert view.snapshot is not None
            assert view.snapshot.total_minor_units == 4_500_000
            assert view.snapshot.water_category_label == "Potable Water"
        finally:
            async with sessions() as session:
                await session.execute(
                    update(WaterCategory)
                    .where(WaterCategory.id == potable.id)
                    .values(label="Potable Water")
                )
                await session.commit()

    run(scenario)


def test_decision_10_a_suspended_source_warns_but_does_not_block_assigning(
    created: Created, vehicle_ids: list[uuid.UUID]
) -> None:
    async def scenario(sessions: Sessions) -> None:
        s, potable, order = await ready(sessions, created)
        await confirm(sessions, s, order, request(potable, s), MockSmsProvider())
        async with sessions() as session:
            await session.execute(
                update(WaterSourceCategory)
                .where(WaterSourceCategory.source_id == s.source_id)
                .values(status=ActivationStatus.SUSPENDED, status_reason="Safety concern")
            )
            await session.commit()
        async with sessions() as session:
            fresh = await session.get(Order, order.id)
            assert fresh is not None
            view = await confirmation.confirmation_view(session, fresh, today=TODAY)
        assert view.source is not None
        assert view.source.reasons == [EligibilityReason.SUSPENDED]

        driver = await add_user(sessions, created, UserRole.DRIVER)
        vehicle_ids.append(await give_vehicle(sessions, driver))
        async with sessions() as session:
            offered, new = await dispatch_service.offer_order(
                session, reference=order.reference, driver_user_id=driver.id, admin=s.admin
            )
        assert new is True
        assert offered.staff_order.order.status is S.ASSIGNED

    run(scenario)


async def give_vehicle(sessions: Sessions, driver: User) -> uuid.UUID:
    """Give a driver a vehicle that can carry 2,000 litres in one trip; return its id."""
    vehicle = VehicleProfile(vehicle_type="Sample tanker", safe_payload_litres=3000)
    async with sessions() as session:
        session.add(vehicle)
        await session.flush()
        # A driver the technical lead set up: approved (docs/api/partners.md).
        session.add(
            DriverProfile(
                user_id=driver.id,
                vehicle_profile_id=vehicle.id,
                approval_status=ApprovalStatus.APPROVED,
            )
        )
        await session.commit()
    return vehicle.id
