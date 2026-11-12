"""Water source supplier details, order fit and cost edits against a real database (#407).

docs/api/admin-water-sources.md, "Amendment #407" (agreed 2026-11-12, PR #417):
the supplier fields and their audit rows, a kind required to activate, the
cost-only change and its locking, T-09 (a cost change reprices new quotes
only), the order-fit check at quote creation, at quote acceptance, in the C1
options and at confirmation, and a confirmation holding the chosen source's
rows against a concurrent edit.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Reuses the quote world of test_quotes_integration.py; every row is created
here and deleted afterwards.
"""

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.confirmation import service as confirmation
from app.modules.messaging.sms import MockSmsProvider
from app.modules.orders import service as orders
from app.modules.orders.models import Order, OrderStatus
from app.modules.pricing.models import AgreementMethod, Quote
from app.modules.pricing.quotes import ManualReason
from app.modules.sources import admin as sources_admin
from app.modules.sources import service as sources
from app.modules.sources.eligibility import (
    EligibilityReason,
    OrderFit,
    OrderFitReason,
    eligible_sources_for,
    source_order_reasons,
)
from app.modules.sources.models import (
    ActivationStatus,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.shared.lagos_time import lagos_today
from tests import test_deliveries_integration as part1
from tests import test_quotes_integration as quotes_tests
from tests.test_deliveries_integration import (
    TEST_DATABASE_URL,
    Created,
    Sessions,
    expect_error,
    run,
)
from tests.test_quotes_integration import (
    Rows,
    World,
    add_source,
    ask,
    order_for,
    tanker,
    world,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

created = part1.created
rows = quotes_tests.rows
KEKE_600 = OrderFit(litres=600, delivery_type="keke", preferred_kind=None)


async def audits(sessions: Sessions, source_id: uuid.UUID, action: str) -> list[AuditLog]:
    async with sessions() as session:
        return list(
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.target_id == source_id, AuditLog.action == action)
                .order_by(AuditLog.created_at)
            )
        )


async def edit(sessions: Sessions, w: World, source_id: uuid.UUID, **changes: object) -> None:
    async with sessions() as session:
        await sources.update_source(session, actor=w.admin, source_id=source_id, changes=changes)


async def placed_and_verified(sessions: Sessions, w: World) -> Order:
    """A Tanker borehole order placed with a quote, from a verified customer."""
    choice = tanker(w.zone_id)
    answer = await ask(sessions, w.customer, choice)
    assert answer.quote is not None
    async with sessions() as session:
        order, _ = await orders.create_order(
            session, customer_id=w.customer.id, request=order_for(choice, answer.quote.id)
        )
        await session.execute(
            update(User)
            .where(User.id == w.customer.id)
            .values(phone_verified_at=datetime.now(UTC) - timedelta(days=1))
        )
        await session.commit()
    return order


def confirm_input(w: World, source_id: uuid.UUID, now: datetime) -> confirmation.ConfirmInput:
    return confirmation.ConfirmInput(
        expected_status=OrderStatus.AWAITING_CONFIRMATION,
        water_category_id=w.utility.id,
        source_id=source_id,
        window_start_at=now + timedelta(days=1),
        window_end_at=now + timedelta(days=1, hours=2),
        total_minor_units=None,
        agreement_method=AgreementMethod.PHONE_CALL,
        agreed_at=now,
        note=None,
    )


# --- Supplier details -------------------------------------------------------------------


def test_supplier_details_are_saved_and_audited_by_field_name_only(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            source = await sources.add_source(
                session,
                actor=w.admin,
                name="Sample Borehole Supplier",
                approximate_location="Sample gate",
                kind=WaterSourceKind.BOREHOLE,
                details=sources.SupplierDetails(
                    contact_name="Sample Contact",
                    contact_phone="+2348030000000",
                    min_litres_per_order=600,
                    max_litres_per_order=10_000,
                    is_available=True,
                    vehicle_kinds=("tanker",),
                ),
            )
        created.source_ids.append(source.id)
        assert (source.serves_keke, source.serves_tanker) == (False, True)

        await edit(
            sessions,
            w,
            source.id,
            contact_phone=None,
            is_available=False,
            vehicle_kinds=["keke", "tanker"],
            min_litres_per_order=600,  # unchanged: not named in the audit row
        )
        async with sessions() as session:
            saved = await session.get(WaterSource, source.id)
        assert saved is not None
        assert (saved.contact_phone, saved.is_available, saved.vehicle_kinds) == (
            None,
            False,
            ["keke", "tanker"],
        )
        [row] = await audits(sessions, source.id, "water_source_updated")
        assert row.details == {"fields": ["contact_phone", "is_available", "vehicle_kinds"]}
        assert "+234" not in str(row.details) and "Sample Contact" not in str(row.details)

        # The same values again write nothing.
        await edit(sessions, w, source.id, is_available=False)
        assert len(await audits(sessions, source.id, "water_source_updated")) == 1

    run(scenario)


def test_a_maximum_below_the_stored_minimum_is_refused_and_nothing_is_written(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await edit(sessions, w, w.borehole_id, min_litres_per_order=1000)
        async with sessions() as session:
            error = await expect_error(
                sources_admin.update(
                    session,
                    actor=w.admin,
                    source_id=w.borehole_id,
                    name=None,
                    approximate_location=None,
                    kind=None,
                    changes={"max_litres_per_order": 999, "contact_name": "Sample Contact"},
                ),
                422,
                "validation_error",
            )
        assert error.details == [  # type: ignore[comparison-overlap]
            {
                "loc": ["body", "max_litres_per_order"],
                "msg": "The largest order cannot be smaller than the smallest",
                "type": "value_error",
            }
        ]
        async with sessions() as session:
            saved = await session.get(WaterSource, w.borehole_id)
        assert saved is not None
        assert (saved.max_litres_per_order, saved.contact_name) == (None, None)
        # Equal limits are allowed.
        await edit(sessions, w, w.borehole_id, max_litres_per_order=1000)

    run(scenario)


# --- A kind before activation -------------------------------------------------------------


def test_activating_or_renewing_a_source_with_no_kind_writes_nothing(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        no_kind = await add_source(sessions, created, None)
        async with sessions() as session:
            await expect_error(
                sources_admin.activate(
                    session,
                    actor=w.admin,
                    source_id=no_kind,
                    category_id=w.utility.id,
                    approved_until=lagos_today() + timedelta(days=90),
                    report_reference="SAMPLE-LR-0002",
                    cost_per_litre_minor_units=150,
                ),
                409,
                "water_source_kind_required",
            )
        async with sessions() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(WaterSourceCategory)
                .where(WaterSourceCategory.source_id == no_kind)
            )
        assert count == 0
        assert await audits(sessions, no_kind, "water_source_activated") == []

        # A legacy activated source whose kind is missing cannot be renewed either.
        async with sessions() as session:
            await session.execute(
                update(WaterSource).where(WaterSource.id == w.borehole_id).values(kind=None)
            )
            await session.commit()
        before = len(await audits(sessions, w.borehole_id, "water_source_activated"))
        async with sessions() as session:
            with pytest.raises(sources.KindRequiredError):
                await sources.activate(
                    session,
                    actor=w.admin,
                    source_id=w.borehole_id,
                    category_code="utility",
                    approved_until=date(2030, 1, 1),
                    report_reference="SAMPLE-LR-0003",
                    cost_per_litre_minor_units=999,
                )
            activation = await session.scalar(
                select(WaterSourceCategory).where(WaterSourceCategory.source_id == w.borehole_id)
            )
        assert activation is not None
        assert (activation.report_reference, activation.cost_per_litre_minor_units) == (
            "LR-0001",
            150,
        )
        assert len(await audits(sessions, w.borehole_id, "water_source_activated")) == before

    run(scenario)


# --- The cost on its own ------------------------------------------------------------------


def test_a_cost_change_touches_only_the_cost_and_audits_no_amount(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            changed = await sources.change_cost(
                session,
                actor=w.admin,
                source_id=w.borehole_id,
                category_code="utility",
                cost_per_litre_minor_units=180,
            )
        assert (changed.cost_per_litre_minor_units, changed.status) == (
            180,
            ActivationStatus.ACTIVATED,
        )
        assert changed.report_reference == "LR-0001"
        [row] = await audits(sessions, w.borehole_id, "water_source_cost_changed")
        assert row.details == {"water_category_id": str(w.utility.id)}

        # The same cost again writes nothing.
        async with sessions() as session:
            await sources.change_cost(
                session,
                actor=w.admin,
                source_id=w.borehole_id,
                category_code="utility",
                cost_per_litre_minor_units=180,
            )
        assert len(await audits(sessions, w.borehole_id, "water_source_cost_changed")) == 1

    run(scenario)


def test_a_stale_cost_change_never_undoes_a_suspension(created: Created, rows: Rows) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as stale:
            # This session loaded the activation while it was still activated.
            loaded = await stale.scalar(
                select(WaterSourceCategory).where(WaterSourceCategory.source_id == w.borehole_id)
            )
            assert loaded is not None and loaded.status is ActivationStatus.ACTIVATED
            await stale.commit()
            async with sessions() as other:
                await sources.set_inactive_status(
                    other,
                    actor=w.admin,
                    source_id=w.borehole_id,
                    category_code="utility",
                    status=ActivationStatus.SUSPENDED,
                    reason="Sample pump repair.",
                )
            after = await sources.change_cost(
                stale,
                actor=w.admin,
                source_id=w.borehole_id,
                category_code="utility",
                cost_per_litre_minor_units=200,
            )
        assert (after.status, after.status_reason, after.cost_per_litre_minor_units) == (
            ActivationStatus.SUSPENDED,
            "Sample pump repair.",
            200,
        )

    run(scenario)


@pytest.mark.parametrize("missing", ["source", "category", "activation"])
def test_the_cost_change_404s_in_the_contract_order(
    created: Created, rows: Rows, missing: str
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        source_id = uuid.uuid4() if missing == "source" else w.borehole_id
        category_id = uuid.uuid4() if missing in ("source", "category") else w.potable.id
        code = {
            "source": "water_source_not_found",
            "category": "water_category_not_found",
            "activation": "activation_not_found",
        }[missing]
        async with sessions() as session:
            await expect_error(
                sources_admin.change_cost(
                    session,
                    actor=w.admin,
                    source_id=source_id,
                    category_id=category_id,
                    cost_per_litre_minor_units=180,
                ),
                404,
                code,
            )

    run(scenario)


def test_t09_a_cost_change_prices_new_quotes_only(created: Created, rows: Rows) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        choice = tanker(w.zone_id)
        first = await ask(sessions, w.customer, choice)
        assert first.quote is not None and first.quote.total_minor_units == 880_000

        async with sessions() as session:
            await sources.change_cost(
                session,
                actor=w.admin,
                source_id=w.borehole_id,
                category_code="utility",
                cost_per_litre_minor_units=300,
            )
        second = await ask(sessions, w.customer, choice)
        assert second.quote is not None
        assert second.quote.cost_per_litre_minor_units == 300

        async with sessions() as session:
            kept = await session.get(Quote, first.quote.id)
            assert kept is not None
            assert (kept.cost_per_litre_minor_units, kept.total_minor_units) == (150, 880_000)
            # The earlier quote is still accepted at its own price.
            order, made = await orders.create_order(
                session, customer_id=w.customer.id, request=order_for(choice, first.quote.id)
            )
        assert made and order.quote_id == first.quote.id
        async with sessions() as session:
            again = await session.get(Quote, first.quote.id)
        assert again is not None and again.total_minor_units == 880_000

    run(scenario)


# --- The order-fit check --------------------------------------------------------------------


def test_a_quote_uses_only_sources_that_fit_the_order(created: Created, rows: Rows) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        choice = tanker(w.zone_id)  # 3,000 litres by tanker, borehole preferred

        await edit(sessions, w, w.borehole_id, max_litres_per_order=2999)
        assert (await ask(sessions, w.customer, choice)).reason is ManualReason.NO_ELIGIBLE_SOURCE
        await edit(sessions, w, w.borehole_id, max_litres_per_order=3000)
        assert (await ask(sessions, w.customer, choice)).reason is None

        await edit(sessions, w, w.borehole_id, vehicle_kinds=["keke"])
        assert (await ask(sessions, w.customer, choice)).reason is ManualReason.NO_ELIGIBLE_SOURCE
        await edit(sessions, w, w.borehole_id, vehicle_kinds=["keke", "tanker"])

        await edit(sessions, w, w.borehole_id, is_available=False)
        assert (await ask(sessions, w.customer, choice)).reason is ManualReason.NO_ELIGIBLE_SOURCE

        async with sessions() as session:
            candidates = await eligible_sources_for(
                session,
                water_category_id=w.utility.id,
                fit=OrderFit(3000, "tanker", WaterSourceKind.BOREHOLE),
                today=lagos_today(),
            )
        [mine] = [c for c in candidates if c.source_id == w.borehole_id]
        assert (mine.eligible, mine.reasons) == (False, [OrderFitReason.UNAVAILABLE])

    run(scenario)


def test_accepting_a_quote_is_refused_when_its_sources_no_longer_fit(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        choice = tanker(w.zone_id)
        answer = await ask(sessions, w.customer, choice)
        assert answer.quote is not None
        await edit(sessions, w, w.borehole_id, is_available=False)
        async with sessions() as session:
            await expect_error(
                orders.create_order(
                    session,
                    customer_id=w.customer.id,
                    request=order_for(choice, answer.quote.id),
                ),
                409,
                "no_eligible_source",
            )
        async with sessions() as session:
            placed = await session.scalar(
                select(func.count()).select_from(Order).where(Order.customer_id == w.customer.id)
            )
        assert placed == 0

    run(scenario)


def test_c1_options_carry_the_order_fit_reasons(created: Created, rows: Rows) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        keke_only = await add_source(
            sessions, created, WaterSourceKind.NINTH_MILE, utility=w.utility
        )
        await edit(sessions, w, keke_only, vehicle_kinds=["keke"], is_available=False)
        order = await placed_and_verified(sessions, w)
        async with sessions() as session:
            options = await confirmation.confirmation_options(session, reference=order.reference)
        [utility] = [item for item in options if item.category.id == w.utility.id]
        reasons = {option.source.id: option.reasons for option in utility.sources}
        assert reasons[w.borehole_id] == []
        assert reasons[keke_only] == [
            OrderFitReason.UNAVAILABLE,
            OrderFitReason.KIND_MISMATCH,
            OrderFitReason.VEHICLE_NOT_SUITABLE,
        ]
        # The order detail keeps the four safety reasons only.
        async with sessions() as session:
            view = await confirmation.confirmation_view(session, order)
        assert view.source is None  # not confirmed yet

    run(scenario)


def test_confirmation_rechecks_a_source_changed_after_the_options_were_loaded(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        order = await placed_and_verified(sessions, w)
        async with sessions() as session:
            await confirmation.confirmation_options(session, reference=order.reference)
        # Another admin marks the source unavailable before the dispatcher confirms.
        await edit(sessions, w, w.borehole_id, is_available=False)
        now = datetime.now(UTC) + timedelta(seconds=5)
        sms = MockSmsProvider()
        async with sessions() as session:
            error = await expect_error(
                confirmation.confirm_order(
                    session,
                    reference=order.reference,
                    admin=w.admin,
                    data=confirm_input(w, w.borehole_id, now),
                    sms=sms,
                    now=now,
                ),
                409,
                "transition_requirements_unmet",
            )
        assert error.details == {"missing": ["source_eligible"]}
        assert sms.outbox == []
        async with sessions() as session:
            still = await session.get(Order, order.id)
        assert still is not None and still.status is OrderStatus.AWAITING_CONFIRMATION

        # Available again: the same request confirms.
        await edit(sessions, w, w.borehole_id, is_available=True)
        async with sessions() as session:
            await confirmation.confirm_order(
                session,
                reference=order.reference,
                admin=w.admin,
                data=confirm_input(w, w.borehole_id, now),
                sms=sms,
                now=now,
            )

    run(scenario)


def test_a_source_edit_waits_for_a_confirmation_holding_the_source(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as confirming:
            reasons = await source_order_reasons(
                confirming,
                source_id=w.borehole_id,
                water_category_id=w.utility.id,
                fit=OrderFit(3000, "tanker", WaterSourceKind.BOREHOLE),
                today=lagos_today(),
            )
            assert reasons == []
            # The chosen source's rows are held FOR SHARE until this transaction ends.
            edit_task = asyncio.create_task(edit(sessions, w, w.borehole_id, is_available=False))
            await asyncio.sleep(0.5)
            assert not edit_task.done()
            await confirming.commit()
        await asyncio.wait_for(edit_task, timeout=10)
        async with sessions() as session:
            saved = await session.get(WaterSource, w.borehole_id)
            reasons = await source_order_reasons(
                session,
                source_id=w.borehole_id,
                water_category_id=w.utility.id,
                fit=OrderFit(3000, "tanker", WaterSourceKind.BOREHOLE),
                today=lagos_today(),
            )
        assert saved is not None and saved.is_available is False
        assert reasons == [OrderFitReason.UNAVAILABLE]

    run(scenario)


def test_a_legacy_activated_source_with_no_kind_serves_nothing(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            await session.execute(
                update(WaterSource).where(WaterSource.id == w.borehole_id).values(kind=None)
            )
            await session.commit()
            candidates = await eligible_sources_for(
                session, water_category_id=w.utility.id, fit=KEKE_600, today=lagos_today()
            )
        [mine] = [c for c in candidates if c.source_id == w.borehole_id]
        assert mine.reasons == [OrderFitReason.KIND_NOT_SET]
        # Never activated for potable: the safety reason comes first.
        async with sessions() as session:
            potable = await eligible_sources_for(
                session, water_category_id=w.potable.id, fit=KEKE_600, today=lagos_today()
            )
        [mine] = [c for c in potable if c.source_id == w.borehole_id]
        assert mine.reasons == [EligibilityReason.NOT_ACTIVATED, OrderFitReason.KIND_NOT_SET]

    run(scenario)
