"""Water source records and the shared eligibility check against a real database (#112).

Covers the command-line service (add a source, activate, suspend, revoke,
renew) with its audit rows (NFR-004); the database rules on activations; and
the hold review's source review (R2) answering from the records: no water
category, not activated, eligible (Continue allowed), suspended and expired
(FR-012, BR-10, T-04).

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every row is created here and deleted afterwards.
"""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import psycopg
import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User, UserRole
from app.modules.deliveries import holds, service
from app.modules.deliveries.models import HoldKind
from app.modules.messaging.sms import MockSmsProvider
from app.modules.orders.models import Order, OrderStatus
from app.modules.sources import service as sources
from app.modules.sources.eligibility import source_reasons
from app.modules.sources.models import (
    ActivationStatus,
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.shared.lagos_time import lagos_today
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
from tests.test_driver_job_steps_integration import WINDOW_START

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]

created = part1.created
ANSWER = holds.EligibilityAnswer


@pytest.fixture(autouse=True)
def delete_audit_rows(created: Created) -> Iterator[None]:
    """Delete this module's audit rows before part 1 deletes the users (RESTRICT)."""
    yield
    url = get_settings().sync_database_url.set(drivername="postgresql")
    with psycopg.connect(url.render_as_string(hide_password=False)) as connection:
        connection.execute("DELETE FROM audit_logs WHERE actor_id = ANY(%s)", (created.user_ids,))


async def category(sessions: Sessions, code: str) -> WaterCategory:
    async with sessions() as session:
        row = await session.scalar(select(WaterCategory).where(WaterCategory.code == code))
    assert row is not None, "migration 0011 seeds the categories"
    return row


async def source_audit(sessions: Sessions, source_id: object) -> list[tuple[str, dict]]:
    async with sessions() as session:
        rows = await session.scalars(
            select(AuditLog)
            .where(AuditLog.target_type == "water_source", AuditLog.target_id == source_id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
        return [(row.action, row.details) for row in rows]


def test_seeded_categories() -> None:
    async def scenario(sessions: Sessions) -> None:
        async with sessions() as session:
            rows = await sources.list_categories(session)
        assert [(row.code, row.label, row.is_active) for row in rows] == [
            ("potable", "Potable Water", True),
            ("utility", "Utility Water", True),
        ]

    run(scenario)


def test_command_line_lifecycle_is_audited(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        admin = await add_user(sessions, created, UserRole.ADMIN)
        driver = await add_user(sessions, created, UserRole.DRIVER)
        potable = await category(sessions, "potable")

        async with sessions() as session:
            assert (await sources.get_acting_admin(session, phone=admin.phone)).id == admin.id
            with pytest.raises(LookupError):
                await sources.get_acting_admin(session, phone=driver.phone)

        async with sessions() as session:
            source = await sources.add_source(
                session,
                actor=admin,
                name="Sample Borehole C",
                approximate_location="Emene",
                kind=WaterSourceKind.BOREHOLE,
            )
        created.source_ids.append(source.id)

        async with sessions() as session:
            activation = await sources.activate(
                session,
                actor=admin,
                source_id=source.id,
                category_code="potable",
                approved_until=date(2027, 1, 30),
                report_reference="LR-0001",
                cost_per_litre_minor_units=150,
            )
        assert (activation.status, activation.status_reason) == (ActivationStatus.ACTIVATED, None)

        async with sessions() as session:
            suspended = await sources.set_inactive_status(
                session,
                actor=admin,
                source_id=source.id,
                category_code="potable",
                status=ActivationStatus.SUSPENDED,
                reason="Safety concern reported",
            )
        assert (suspended.status, suspended.status_reason) == (
            ActivationStatus.SUSPENDED,
            "Safety concern reported",
        )

        # Renewing clears the reason and keeps one row per source and category.
        async with sessions() as session:
            renewed = await sources.activate(
                session,
                actor=admin,
                source_id=source.id,
                category_code="potable",
                approved_until=date(2027, 6, 30),
                report_reference="LR-0007",
                cost_per_litre_minor_units=160,
            )
        assert renewed.id == activation.id
        assert (renewed.status_reason, renewed.report_reference) == (None, "LR-0007")

        async with sessions() as session:
            await sources.set_inactive_status(
                session,
                actor=admin,
                source_id=source.id,
                category_code="potable",
                status=ActivationStatus.REVOKED,
                reason="Supplier withdrew",
            )
            listed = [
                row for row in await sources.list_sources(session) if row.source.id == source.id
            ]
        assert [(a.status, c.code) for a, c in listed[0].activations] == [
            (ActivationStatus.REVOKED, "potable")
        ]

        # Never the cost, the report reference or the reason in the metadata.
        category_id = str(potable.id)
        assert await source_audit(sessions, source.id) == [
            ("water_source_added", {}),
            ("water_source_activated", {"water_category_id": category_id, "status": "activated"}),
            ("water_source_suspended", {"water_category_id": category_id, "status": "suspended"}),
            ("water_source_activated", {"water_category_id": category_id, "status": "activated"}),
            ("water_source_revoked", {"water_category_id": category_id, "status": "revoked"}),
        ]

        async with sessions() as session:
            with pytest.raises(LookupError):
                await sources.activate(
                    session,
                    actor=admin,
                    source_id=source.id,
                    category_code="drinking",
                    approved_until=date(2027, 1, 30),
                    report_reference="LR-1",
                    cost_per_litre_minor_units=1,
                )
            with pytest.raises(LookupError, match="no activation for utility"):
                await sources.set_inactive_status(
                    session,
                    actor=admin,
                    source_id=source.id,
                    category_code="utility",
                    status=ActivationStatus.SUSPENDED,
                    reason="x",
                )

    run(scenario)


def test_database_rules_on_activations(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        potable = await category(sessions, "potable")

        def row(**changes: object) -> WaterSourceCategory:
            values: dict[str, object] = {
                "source_id": s.source_id,
                "water_category_id": potable.id,
                "status": ActivationStatus.ACTIVATED,
                "approved_until": date(2027, 1, 30),
                "report_reference": "LR-1",
                "cost_per_litre_minor_units": 100,
                "status_reason": None,
            }
            return WaterSourceCategory(**{**values, **changes})

        for bad in (
            row(status_reason="Activated rows have no reason"),
            row(status=ActivationStatus.SUSPENDED),  # suspended needs a reason
            row(cost_per_litre_minor_units=-1),
        ):
            async with sessions() as session:
                session.add(bad)
                with pytest.raises(IntegrityError):
                    await session.commit()

        async with sessions() as session:
            session.add(row())
            await session.commit()
        async with sessions() as session:
            session.add(row())  # one activation per source and category
            with pytest.raises(IntegrityError):
                await session.commit()

    run(scenario)


# --- Source review (R2) from the records ----------------------------------------------


async def on_source_review_at_assigned_source(sessions: Sessions, s: Setup, driver: User) -> str:
    """A job collected at its **assigned** source with a safety concern."""
    reference = await add_job(
        sessions, s, driver, order_status=OrderStatus.ACCEPTED, window_start=WINDOW_START
    )
    async with sessions() as session:
        await service.take_step(
            session,
            driver=driver,
            reference=reference,
            step=service.DriverStep.DEPARTED,
            note=None,
            sms=MockSmsProvider(),
        )
    async with sessions() as session:
        await service.record_pickup(
            session,
            driver=driver,
            reference=reference,
            pickup=service.NewPickup(
                assigned_source=True,
                other_source_name=None,
                source_reference="R-20482",
                volume_collected_litres=1200,
                picked_up_at=datetime.now(UTC),
                safety_concern=True,
                safety_note="The tank lid was open.",
            ),
        )
    async with sessions() as session:
        detail = await holds.get_order_detail(session, reference=reference)
    assert detail.hold is not None and detail.hold.hold_kind is HoldKind.SOURCE_REVIEW
    return reference


async def answer(sessions: Sessions, reference: str) -> holds.SourceEligibility | None:
    async with sessions() as session:
        return (await holds.get_hold_review(session, reference=reference)).source_eligibility


def test_source_review_answers_from_the_records(created: Created) -> None:
    async def scenario(sessions: Sessions) -> None:
        s = await setup(sessions, created)
        potable = await category(sessions, "potable")
        driver = await add_user(sessions, created, UserRole.DRIVER)
        reference = await on_source_review_at_assigned_source(sessions, s, driver)

        # 1. No water category on the order yet (set at confirmation, #113).
        assert await answer(sessions, reference) == holds.SourceEligibility(
            ANSWER.CANNOT_CHECK, "This order has no water category."
        )

        async with sessions() as session:
            await session.execute(
                update(Order)
                .where(Order.reference == reference)
                .values(water_category_id=potable.id)
            )
            await session.commit()

        # 2. The source has no activation for the category.
        assert await answer(sessions, reference) == holds.SourceEligibility(
            ANSWER.NOT_ELIGIBLE, "This source is not activated for this water category."
        )

        # 3. Expired yesterday (T-04).
        async with sessions() as session:
            session.add(
                WaterSourceCategory(
                    source_id=s.source_id,
                    water_category_id=potable.id,
                    status=ActivationStatus.ACTIVATED,
                    approved_until=lagos_today() - timedelta(days=1),
                    report_reference="LR-0002",
                    cost_per_litre_minor_units=150,
                )
            )
            await session.commit()
        assert await answer(sessions, reference) == holds.SourceEligibility(
            ANSWER.NOT_ELIGIBLE,
            "This source's laboratory approval for this water category has expired.",
        )

        # 4. Suspended and expired: the first reason's message (contract order).
        async with sessions() as session:
            await session.execute(
                update(WaterSourceCategory)
                .where(WaterSourceCategory.source_id == s.source_id)
                .values(status=ActivationStatus.SUSPENDED, status_reason="Safety concern")
            )
            await session.commit()
        assert await answer(sessions, reference) == holds.SourceEligibility(
            ANSWER.NOT_ELIGIBLE, "This source is suspended for this water category."
        )

        # 5. Activated and current through today: eligible, and Continue works.
        async with sessions() as session:
            await session.execute(
                update(WaterSourceCategory)
                .where(WaterSourceCategory.source_id == s.source_id)
                .values(
                    status=ActivationStatus.ACTIVATED,
                    status_reason=None,
                    approved_until=lagos_today(),
                )
            )
            await session.commit()
        review_answer = await answer(sessions, reference)
        assert review_answer == holds.SourceEligibility(
            ANSWER.ELIGIBLE, "This source is activated for the order's water category."
        )
        async with sessions() as session:
            review = await holds.get_hold_review(session, reference=reference)
        async with sessions() as session:
            detail = await holds.continue_source(
                session,
                reference=reference,
                admin=s.admin,
                hold_id=review.hold.id,
                note="Source activated for Potable Water.",
            )
        assert detail.hold is None

    run(scenario)


def test_a_simulated_source_counts_like_any_other(created: Created) -> None:
    # Contract decision 9: a real order may use a simulated source for now.
    async def scenario(sessions: Sessions) -> None:
        potable = await category(sessions, "potable")
        source = WaterSource(
            name="Demo Tanker Yard",
            approximate_location="Coal Camp",
            is_simulated=True,
            kind=WaterSourceKind.NINTH_MILE,
        )
        async with sessions() as session:
            session.add(source)
            await session.commit()
        created.source_ids.append(source.id)
        async with sessions() as session:
            session.add(
                WaterSourceCategory(
                    source_id=source.id,
                    water_category_id=potable.id,
                    status=ActivationStatus.ACTIVATED,
                    approved_until=lagos_today(),
                    report_reference="LR-0009",
                    cost_per_litre_minor_units=0,
                )
            )
            await session.commit()
        async with sessions() as session:
            reasons = await source_reasons(
                session, source_id=source.id, water_category_id=potable.id, today=lagos_today()
            )
        assert reasons == []

    run(scenario)
