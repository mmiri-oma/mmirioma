"""Road-distance pricing against a real database (#385).

docs/api/order-details-and-price.md, "Amendment #385: road-distance pricing"
(agreed 2026-11-03), with a fake OSRM: the road distance used and the exact
kobo, the longest of several sources, the snapshot a quote keeps (FR-024), every
fallback to the zone's fee (T-18), a source's pickup point (set, cleared and
audited without its coordinates), and that a stored quote never changes.

Runs only when TEST_DATABASE_URL is set (``alembic upgrade head`` first).
Every row is created here and deleted afterwards.
"""

import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any

import httpx2
import pytest
from geoalchemy2 import Geometry
from sqlalchemy import cast, delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.audit.models import AuditLog
from app.modules.dispatch.models import VehicleProfile
from app.modules.orders import service as orders
from app.modules.pricing import quotes
from app.modules.pricing.models import DeliveryBasis, PriceRule, Quote
from app.modules.pricing.osrm import FallbackReason
from app.modules.pricing.quotes import ManualReason
from app.modules.sources import service as sources
from app.modules.sources.eligibility import OrderFit, eligible_sources_for
from app.modules.sources.models import WaterSource, WaterSourceKind
from app.shared.location import Location, LocationSource
from tests import test_quotes_integration as part1
from tests.test_deliveries_integration import Created, Sessions, run
from tests.test_quotes_integration import (
    Rows,
    World,
    add_source,
    add_zone,
    category,
    order_for,
    rows,
    tanker,
    world,
)

pytestmark = part1.pytestmark

created = part1.created
rows = rows  # re-exported fixture, so pytest finds it in this module

PIN = Location(latitude=6.452713, longitude=7.510348, source=LocationSource.MAP_PIN)
SOURCE_A = sources.SourceLocation(latitude=6.4361, longitude=7.5134)
SOURCE_B = sources.SourceLocation(latitude=6.4800, longitude=7.4900)

# The world's rule: base 100,000, 10,000 a km, 80,000 for an extra trip, 500 handling,
# a 10% margin, a ₦1.50 litre. 3,000 L on a 3,000 L vehicle is one trip.
WATER = 450_000
HANDLING = 50_000
ZONE_FEE = 300_000


@pytest.fixture
def osrm_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("OSRM_BASE_URL", "http://osrm.test")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class FakeOsrm:
    """A fake OSRM keyed by source coordinates, so the order the sources come in does not matter."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self.metres: dict[tuple[float, float], float | None] = {}
        self.failure: Exception | None = None
        self.status = 200

    def answer(self, location: sources.SourceLocation, metres: float | None) -> None:
        self.metres[(location.longitude, location.latitude)] = metres

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        if self.status != 200:
            return httpx2.Response(self.status, text="error")
        pairs = request.url.path.removeprefix("/table/v1/driving/").split(";")[:-1]
        wanted = [tuple(float(part) for part in pair.split(",")) for pair in pairs]
        return httpx2.Response(
            200,
            json={"code": "Ok", "distances": [[self.metres[w]] for w in wanted]},  # type: ignore[index]
        )

    @property
    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self.handler)


async def set_location(
    sessions: Sessions, admin: Any, source_id: uuid.UUID, location: sources.SourceLocation | None
) -> None:
    async with sessions() as session:
        await sources.update_source(session, actor=admin, source_id=source_id, location=location)


async def ask(
    sessions: Sessions,
    w: World,
    fake: FakeOsrm,
    *,
    location: Location | None = PIN,
    zone_id: uuid.UUID | None = None,
) -> quotes.QuoteAnswer:
    async with sessions() as session:
        return await quotes.create_quote(
            session,
            customer_id=w.customer.id,
            choice=tanker(zone_id or w.zone_id),
            delivery_location=location,
            osrm_transport=fake.transport,
        )


async def stored(sessions: Sessions, quote_id: uuid.UUID) -> Quote:
    async with sessions() as session:
        quote = await session.get(Quote, quote_id)
    assert quote is not None
    return quote


def total(delivery: int) -> int:
    """The quote total for a delivery cost: water + delivery + handling + 10%, up to whole naira."""
    base = WATER + delivery + HANDLING
    subtotal = base + (base * 1000 + 5000) // 10_000
    return -(-subtotal // 100) * 100


def test_a_quote_uses_the_road_distance_and_records_how(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 5_678.4)

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        # 5,678 m at 10,000 a km = 56,780; plus the base fee of 100,000; one trip.
        delivery = 100_000 + 56_780
        assert quote.delivery_minor_units == delivery
        assert quote.total_minor_units == total(delivery)
        assert (quote.delivery_basis, quote.road_distance_metres) == (
            DeliveryBasis.ROAD_DISTANCE,
            5_678,
        )
        assert quote.distance_source_id == w.borehole_id
        assert quote.distance_fallback_reason is None
        # The rates as applied (FR-024).
        assert (
            quote.base_delivery_fee_minor_units,
            quote.distance_rate_minor_units_per_km,
            quote.additional_trip_minor_units,
        ) == (100_000, 10_000, 80_000)
        assert quote.delivery_location_source == "map_pin"
        assert len(fake.requests) == 1

    run(scenario)


def test_the_longest_of_several_sources_prices_the_delivery(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        second = await add_source(sessions, created, WaterSourceKind.BOREHOLE, utility=w.utility)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        await set_location(sessions, w.admin, second, SOURCE_B)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 2_000)
        fake.answer(SOURCE_B, 9_000)

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        assert (quote.road_distance_metres, quote.distance_source_id) == (9_000, second)
        assert quote.delivery_minor_units == 100_000 + 90_000
        assert len(fake.requests) == 1  # one request, however many sources

    run(scenario)


def test_two_trips_add_the_additional_trip_charge(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            await session.execute(
                update(VehicleProfile)
                .where(VehicleProfile.id.in_(rows.vehicle_ids))
                .values(safe_payload_litres=1600)
            )
            await session.commit()
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 1_000)

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        assert answer.quote.trips == 2
        # 100,000 base + 10,000 distance (once, one way) + 80,000 for the second trip.
        assert answer.quote.delivery_minor_units == 100_000 + 10_000 + 80_000

    run(scenario)


@pytest.mark.parametrize(
    ("failure", "status", "metres", "reason"),
    [
        (httpx2.ReadTimeout("slow"), 200, 1.0, FallbackReason.TIMEOUT),
        (httpx2.ConnectError("refused"), 200, 1.0, FallbackReason.OSRM_UNAVAILABLE),
        (None, 500, 1.0, FallbackReason.OSRM_UNAVAILABLE),
        (None, 200, None, FallbackReason.NO_ROUTE),
    ],
)
def test_osrm_down_slow_or_without_a_route_falls_back_to_the_zone_fee(
    created: Created,
    rows: Rows,
    osrm_on: None,
    failure: Exception | None,
    status: int,
    metres: float | None,
    reason: FallbackReason,
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, metres)
        fake.failure, fake.status = failure, status

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        assert quote.delivery_minor_units == ZONE_FEE
        assert quote.total_minor_units == total(ZONE_FEE)
        assert quote.delivery_basis is DeliveryBasis.ZONE_FEE
        assert quote.distance_fallback_reason is reason
        assert quote.road_distance_metres is None and quote.distance_source_id is None
        assert quote.base_delivery_fee_minor_units is None
        # The pin is still the one the quote was priced for.
        assert quote.delivery_location_source == "map_pin"

    run(scenario)


def test_a_source_without_a_pickup_point_sends_the_quote_to_the_zone_fee_without_asking_osrm(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        no_point = await add_source(sessions, created, WaterSourceKind.BOREHOLE, utility=w.utility)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)  # no_point has none
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 1_000)

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        assert quote.delivery_minor_units == ZONE_FEE
        assert quote.distance_fallback_reason is FallbackReason.NO_SOURCE_LOCATION
        assert fake.requests == []
        assert no_point != w.borehole_id

    run(scenario)


def test_no_delivery_location_means_the_zone_fee_and_no_reason(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 1_000)

        answer = await ask(sessions, w, fake, location=None)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        assert quote.delivery_minor_units == ZONE_FEE
        assert quote.delivery_basis is DeliveryBasis.ZONE_FEE
        assert quote.distance_fallback_reason is None
        assert quote.delivery_location_source is None
        assert fake.requests == []

    run(scenario)


def test_with_osrm_off_a_quote_is_priced_exactly_as_before(
    created: Created, rows: Rows, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OSRM_BASE_URL", "")
    get_settings.cache_clear()

    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 1_000)

        answer = await ask(sessions, w, fake)

        assert answer.quote is not None
        quote = await stored(sessions, answer.quote.id)
        assert (quote.delivery_minor_units, quote.delivery_basis) == (
            ZONE_FEE,
            DeliveryBasis.ZONE_FEE,
        )
        assert quote.distance_fallback_reason is None  # nothing was tried
        assert fake.requests == []

    run(scenario)
    get_settings.cache_clear()


def test_without_a_zone_fee_a_road_distance_still_prices_the_quote(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        no_fee_zone = await add_zone(sessions, rows, w.admin, fees=[])
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 4_000)

        answer = await ask(sessions, w, fake, zone_id=no_fee_zone)

        assert answer.quote is not None
        assert answer.quote.delivery_minor_units == 100_000 + 40_000

    run(scenario)


def test_without_a_zone_fee_and_without_a_road_distance_the_quote_is_manual_and_stores_nothing(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        no_fee_zone = await add_zone(sessions, rows, w.admin, fees=[])
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.failure = httpx2.ConnectError("down")

        answer = await ask(sessions, w, fake, zone_id=no_fee_zone)

        assert (answer.quote, answer.reason) == (None, ManualReason.DELIVERY_COST_UNAVAILABLE)
        async with sessions() as session:
            count = await session.scalar(
                select(func.count()).select_from(Quote).where(Quote.customer_id == w.customer.id)
            )
        assert count == 0

    run(scenario)


def test_no_price_rule_is_still_a_manual_quote_with_a_road_distance(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            await session.execute(delete(PriceRule))
            await session.commit()
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 1_000)

        answer = await ask(sessions, w, fake)

        assert (answer.quote, answer.reason) == (None, ManualReason.NO_PRICE_RULE)
        assert fake.requests == []  # the rates come from the rule, so OSRM is not asked

    run(scenario)


def test_a_stored_quote_never_changes_when_a_source_or_osrm_changes(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 5_000)
        answer = await ask(sessions, w, fake)
        assert answer.quote is not None
        before = await stored(sessions, answer.quote.id)

        await set_location(sessions, w.admin, w.borehole_id, SOURCE_B)
        fake.answer(SOURCE_B, 20_000)
        again = await ask(sessions, w, fake)

        after = await stored(sessions, answer.quote.id)
        assert after.delivery_minor_units == before.delivery_minor_units == 150_000
        assert after.total_minor_units == before.total_minor_units
        assert after.road_distance_metres == 5_000
        assert again.quote is not None
        assert again.quote.delivery_minor_units == 100_000 + 200_000  # the new quote does

    run(scenario)


# --- The quote pin must match the order pin ------------------------------------------


async def place(
    sessions: Sessions, w: World, quote_id: uuid.UUID, location: Location | None
) -> Any:
    async with sessions() as session:
        return await orders.create_order(
            session,
            customer_id=w.customer.id,
            request=order_for(tanker(w.zone_id), quote_id, delivery_location=location),
        )


def test_an_order_with_the_quote_pin_is_placed_and_keeps_its_own_copy(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 5_000)
        answer = await ask(sessions, w, fake)
        assert answer.quote is not None

        # The same point, set another way: the source is not compared.
        same = Location(
            latitude=PIN.latitude, longitude=PIN.longitude, source=LocationSource.DEVICE_LOCATION
        )
        order, made = await place(sessions, w, answer.quote.id, same)

        assert made and order.quote_id == answer.quote.id
        assert (order.delivery_location_latitude, order.delivery_location_longitude) == (
            PIN.latitude,
            PIN.longitude,
        )

    run(scenario)


def test_an_order_with_another_pin_or_none_is_a_quote_mismatch_on_delivery_location(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 5_000)
        answer = await ask(sessions, w, fake)
        assert answer.quote is not None
        moved = Location(latitude=6.46, longitude=7.52, source=LocationSource.MAP_PIN)

        for location in (moved, None):
            with pytest.raises(APIError) as refused:
                await place(sessions, w, answer.quote.id, location)
            assert (refused.value.status_code, refused.value.code) == (422, "quote_mismatch")
            assert [d["loc"] for d in refused.value.details or []] == [
                ["body", "delivery_location"]
            ]

    run(scenario)


def test_a_quote_priced_without_a_pin_lets_the_order_carry_any_pin(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        answer = await ask(sessions, w, FakeOsrm(), location=None)
        assert answer.quote is not None

        order, made = await place(sessions, w, answer.quote.id, PIN)

        assert made and order.quote_id == answer.quote.id

    run(scenario)


def test_a_quote_whose_pin_was_cleared_no_longer_constrains_the_order(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        fake = FakeOsrm()
        fake.answer(SOURCE_A, 5_000)
        answer = await ask(sessions, w, fake)
        assert answer.quote is not None
        async with sessions() as session:
            await session.execute(
                update(Quote)
                .where(Quote.id == answer.quote.id)
                .values(delivery_location=None, delivery_location_source=None)
            )
            await session.commit()

        _, made = await place(sessions, w, answer.quote.id, None)

        assert made

    run(scenario)


# --- The quote's own constraints -------------------------------------------------------


def test_the_database_refuses_a_road_quote_without_its_distance_or_a_source_without_a_point(
    created: Created, rows: Rows, osrm_on: None
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        fake = FakeOsrm()
        answer = await ask(sessions, w, fake, location=None)
        assert answer.quote is not None
        for values in (
            {"delivery_basis": DeliveryBasis.ROAD_DISTANCE},  # no distance, source or rates
            {"delivery_location_source": "map_pin"},  # a source without a point
        ):
            async with sessions() as session:
                with pytest.raises(IntegrityError):
                    await session.execute(
                        update(Quote).where(Quote.id == answer.quote.id).values(**values)
                    )
                    await session.commit()

    run(scenario)


# --- A source's pickup point -------------------------------------------------------------


def test_a_pickup_point_is_set_read_changed_cleared_and_audited_without_the_coordinates(
    created: Created, rows: Rows
) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        category_id = (await category(sessions, "utility")).id

        async def eligible() -> dict[uuid.UUID, sources.SourceLocation | None]:
            async with sessions() as session:
                found = await eligible_sources_for(
                    session,
                    water_category_id=category_id,
                    fit=OrderFit(3000, "tanker", WaterSourceKind.BOREHOLE),
                    today=date.today(),
                )
            return {item.source_id: item.location for item in found if item.eligible}

        assert (await eligible())[w.borehole_id] is None
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)
        assert (await eligible())[w.borehole_id] == SOURCE_A
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_A)  # no change, no audit
        await set_location(sessions, w.admin, w.borehole_id, SOURCE_B)
        assert (await eligible())[w.borehole_id] == SOURCE_B
        await set_location(sessions, w.admin, w.borehole_id, None)
        assert (await eligible())[w.borehole_id] is None

        async with sessions() as session:
            audit = list(
                await session.scalars(
                    select(AuditLog)
                    .where(AuditLog.target_id == w.borehole_id)
                    .order_by(AuditLog.created_at)
                )
            )
            point = cast(WaterSource.location, Geometry)
            stored_point = (
                await session.execute(
                    select(func.ST_Y(point), func.ST_X(point)).where(
                        WaterSource.id == w.borehole_id
                    )
                )
            ).one()
        assert [row.action for row in audit].count("water_source_updated") == 3  # A, B, cleared
        assert all(row.details == {"fields": ["location"]} for row in audit[-3:])
        assert "6.43" not in str([row.details for row in audit])
        assert stored_point == (None, None)

    run(scenario)


def test_a_source_added_with_a_pickup_point_keeps_it(created: Created, rows: Rows) -> None:
    async def scenario(sessions: Sessions) -> None:
        w = await world(sessions, created, rows)
        async with sessions() as session:
            added = await sources.add_source(
                session,
                actor=w.admin,
                name="Sample Borehole With A Point",
                approximate_location="Near the market gate",
                kind=WaterSourceKind.BOREHOLE,
                location=SOURCE_A,
            )
        created.source_ids.append(added.id)
        async with sessions() as session:
            [view] = await sources.list_sources(session, source_id=added.id)
        assert view.location == SOURCE_A

    run(scenario)
