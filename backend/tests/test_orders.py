"""Order model and reference rules that need no database (FR-021, FR-026, FR-027, FR-033)."""

import re

from sqlalchemy import CheckConstraint, UniqueConstraint

from app.modules.orders.models import Order, OrderEvent, OrderStatus
from app.modules.orders.service import (
    REFERENCE_ALPHABET,
    generate_order_reference,
)

REFERENCE_PATTERN = re.compile(r"MO-[0-9A-HJKMNP-TV-Z]{10}")


def test_statuses_match_the_orders_contract() -> None:
    # docs/api/orders.md, "Order statuses (FR-033)". draft is never stored.
    assert [status.value for status in OrderStatus] == [
        "quote_requested",
        "awaiting_confirmation",
        "confirmed",
        "assigned",
        "accepted",
        "collected",
        "en_route",
        "delivered",
        "cancelled",
        "failed",
        "disputed",
    ]


def test_reference_format_is_prefix_plus_ten_crockford_characters() -> None:
    for _ in range(200):
        assert REFERENCE_PATTERN.fullmatch(generate_order_reference())


def test_reference_alphabet_excludes_ambiguous_letters() -> None:
    assert len(REFERENCE_ALPHABET) == 32
    assert not set("ILOU") & set(REFERENCE_ALPHABET)


def test_references_are_random_not_sequential() -> None:
    references = {generate_order_reference() for _ in range(1000)}
    # 1000 draws from 2^50 values: any repeat would mean the source is broken.
    assert len(references) == 1000


def test_idempotency_key_is_unique_per_customer() -> None:
    unique_column_sets = {
        tuple(column.name for column in constraint.columns)
        for constraint in Order.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("customer_id", "idempotency_key") in unique_column_sets
    assert ("reference",) in unique_column_sets


def test_quantity_range_is_enforced_by_the_database() -> None:
    checks = {
        str(constraint.sqltext)
        for constraint in Order.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert "quantity_litres BETWEEN 1 AND 100000" in checks


def test_sprint_1_orders_store_no_price() -> None:
    # No prices exist yet (FR-021, FR-022, SRS §12); see docs/api/orders.md.
    money_words = ("price", "amount", "total", "kobo", "minor_units", "fee")
    for table in (Order.__table__, OrderEvent.__table__):
        for column in table.columns:
            assert not any(word in column.name for word in money_words), column.name


def test_simulated_flag_defaults_to_false() -> None:
    column = Order.__table__.c.is_simulated
    assert column.server_default is not None
    assert not column.nullable
