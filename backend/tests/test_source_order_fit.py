"""The order-fit check without a database (#407, T-04).

docs/api/admin-water-sources.md, "The order-fit check": every reason alone and
together, in the contract's order, and the litre limits at their boundaries.
The database reads are in test_source_order_fit_integration.py.
"""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest

from app.modules.sources.eligibility import (
    EligibilityReason,
    OrderFit,
    OrderFitReason,
    order_fit_reasons,
    reasons_for_order,
    source_wide_reasons,
)
from app.modules.sources.models import (
    ActivationStatus,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.modules.sources.service import is_source_usable

TODAY = date(2026, 11, 12)
KEKE_600 = OrderFit(litres=600, delivery_type="keke", preferred_kind=None)


def source(**overrides: Any) -> WaterSource:
    """A source that fits every order unless a field is overridden."""
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "name": "Sample Borehole A",
        "approximate_location": "Sample gate",
        "kind": WaterSourceKind.BOREHOLE,
        "contact_name": None,
        "contact_phone": None,
        "min_litres_per_order": None,
        "max_litres_per_order": None,
        "is_available": True,
        "serves_keke": True,
        "serves_tanker": True,
    }
    values.update(overrides)
    return WaterSource(**values)


def activation(**overrides: Any) -> WaterSourceCategory:
    values: dict[str, Any] = {
        "status": ActivationStatus.ACTIVATED,
        "approved_until": TODAY + timedelta(days=30),
        "report_reference": "SAMPLE-LR-0001",
        "cost_per_litre_minor_units": 150,
        "status_reason": None,
    }
    values.update(overrides)
    return WaterSourceCategory(**values)


def test_a_complete_source_fits_any_order() -> None:
    assert reasons_for_order(source(), activation(), KEKE_600, today=TODAY) == []


@pytest.mark.parametrize(
    ("overrides", "fit", "reason"),
    [
        ({"kind": None}, KEKE_600, OrderFitReason.KIND_NOT_SET),
        ({"is_available": False}, KEKE_600, OrderFitReason.UNAVAILABLE),
        (
            {"kind": WaterSourceKind.NINTH_MILE},
            OrderFit(600, "tanker", WaterSourceKind.BOREHOLE),
            OrderFitReason.KIND_MISMATCH,
        ),
        ({"min_litres_per_order": 601}, KEKE_600, OrderFitReason.BELOW_MINIMUM_LITRES),
        ({"max_litres_per_order": 599}, KEKE_600, OrderFitReason.ABOVE_MAXIMUM_LITRES),
        ({"serves_keke": False}, KEKE_600, OrderFitReason.VEHICLE_NOT_SUITABLE),
        (
            {"serves_tanker": False},
            OrderFit(2000, "tanker", None),
            OrderFitReason.VEHICLE_NOT_SUITABLE,
        ),
    ],
)
def test_each_order_fit_reason_alone(
    overrides: dict[str, Any], fit: OrderFit, reason: OrderFitReason
) -> None:
    assert order_fit_reasons(source(**overrides), fit) == [reason]


@pytest.mark.parametrize(("minimum", "maximum"), [(600, None), (None, 600), (600, 600)])
def test_the_litre_limits_include_their_boundaries(
    minimum: int | None, maximum: int | None
) -> None:
    fits = source(min_litres_per_order=minimum, max_litres_per_order=maximum)
    assert order_fit_reasons(fits, KEKE_600) == []


def test_a_source_with_no_kind_is_never_also_a_kind_mismatch() -> None:
    fit = OrderFit(600, "tanker", WaterSourceKind.BOREHOLE)
    assert order_fit_reasons(source(kind=None), fit) == [OrderFitReason.KIND_NOT_SET]


def test_a_keke_order_has_no_preferred_kind_so_any_kind_fits() -> None:
    assert order_fit_reasons(source(kind=WaterSourceKind.NINTH_MILE), KEKE_600) == []


def test_an_order_from_before_delivery_types_skips_the_vehicle_check() -> None:
    legacy = OrderFit(litres=600, delivery_type=None, preferred_kind=None)
    assert order_fit_reasons(source(serves_keke=False), legacy) == []


def test_every_reason_together_comes_in_the_contract_order() -> None:
    everything_wrong = source(
        kind=None,
        is_available=False,
        min_litres_per_order=700,
        serves_keke=False,
    )
    suspended_and_expired = activation(
        status=ActivationStatus.SUSPENDED,
        status_reason="Pump repair.",
        approved_until=TODAY - timedelta(days=1),
    )
    assert reasons_for_order(everything_wrong, suspended_and_expired, KEKE_600, today=TODAY) == [
        EligibilityReason.SUSPENDED,
        EligibilityReason.APPROVAL_EXPIRED,
        OrderFitReason.KIND_NOT_SET,
        OrderFitReason.UNAVAILABLE,
        OrderFitReason.BELOW_MINIMUM_LITRES,
        OrderFitReason.VEHICLE_NOT_SUITABLE,
    ]
    too_big = source(kind=WaterSourceKind.NINTH_MILE, max_litres_per_order=500)
    assert reasons_for_order(
        too_big, None, OrderFit(600, "tanker", WaterSourceKind.BOREHOLE), today=TODAY
    ) == [
        EligibilityReason.NOT_ACTIVATED,
        OrderFitReason.KIND_MISMATCH,
        OrderFitReason.ABOVE_MAXIMUM_LITRES,
    ]


def test_source_wide_reasons_are_kind_not_set_then_unavailable() -> None:
    assert source_wide_reasons(source(kind=None, is_available=False)) == [
        OrderFitReason.KIND_NOT_SET,
        OrderFitReason.UNAVAILABLE,
    ]
    assert source_wide_reasons(source(max_litres_per_order=1)) == []


def test_vehicle_kinds_lists_keke_before_tanker() -> None:
    assert source().vehicle_kinds == ["keke", "tanker"]
    assert source(serves_keke=False).vehicle_kinds == ["tanker"]


def test_the_safety_reasons_keep_their_four_values() -> None:
    # R2 and the order detail rely on exactly these; #407 adds no value to them.
    assert [reason.value for reason in EligibilityReason] == [
        "not_activated",
        "suspended",
        "revoked",
        "approval_expired",
    ]


# --- Usability for the dashboard and live map (#407 review on PR #420) --------------


@pytest.mark.parametrize(
    ("overrides", "activations", "usable"),
    [
        ({}, [{}], True),
        ({"is_available": False}, [{}], False),
        ({"kind": None}, [{}], False),
        ({}, [{"approved_until": TODAY - timedelta(days=1)}], False),
        ({}, [{"status": ActivationStatus.SUSPENDED, "status_reason": "Pump repair."}], False),
        ({}, [{"status": ActivationStatus.REVOKED, "status_reason": "Withdrawn."}], False),
        ({}, [], False),
        # One category still passing is enough.
        ({}, [{"status": ActivationStatus.REVOKED, "status_reason": "Withdrawn."}, {}], True),
        # Order fit is not part of it: limits and vehicles depend on an order.
        ({"max_litres_per_order": 1, "serves_keke": False}, [{}], True),
    ],
)
def test_a_source_is_usable_only_with_no_source_wide_exclusion_and_a_passing_activation(
    overrides: dict[str, Any], activations: list[dict[str, Any]], usable: bool
) -> None:
    rows = [activation(**changes) for changes in activations]
    assert is_source_usable(source(**overrides), rows, today=TODAY) is usable
