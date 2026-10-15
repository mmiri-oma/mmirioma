"""Order persistence: the ``orders`` table and its ``order_events`` history.

Sprint 1 orders are price-less requests (docs/api/orders.md, "Why Sprint 1
orders have no price"): pricing rules, zones and categories are open decisions
(SRS §12), so there is deliberately no amount, quote, zone or slot column yet.
They will be added by migrations when those features are agreed.
"""

import uuid
from datetime import date
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, TimestampMixin, UUIDPrimaryKeyMixin

# Field limits from docs/api/orders.md ("Field rules"). The database enforces
# the quantity range too, so no code path can store nonsense quantities.
MIN_QUANTITY_LITRES = 1
MAX_QUANTITY_LITRES = 100_000
CONTACT_NAME_MAX_LENGTH = 100
DELIVERY_ADDRESS_MAX_LENGTH = 500
LANDMARK_MAX_LENGTH = 200
DELIVERY_INSTRUCTIONS_MAX_LENGTH = 500
# "MO-" plus 10 Crockford base32 characters (see service.generate_order_reference).
REFERENCE_LENGTH = 13


class OrderStatus(StrEnum):
    """Order statuses (FR-033), named as in docs/api/orders.md.

    Ordinary progression: ``quote_requested`` → ``awaiting_confirmation`` →
    ``confirmed`` → ``assigned`` → ``accepted`` → ``collected`` → ``en_route``
    → ``delivered``. Alternatives: ``cancelled``, ``failed``, ``disputed``.

    FR-033's ``draft`` is not stored: an unsubmitted order exists only in the
    browser. Which transitions are allowed, and by whom, is not enforced here
    yet; Sprint 1 only creates orders in ``quote_requested``.
    """

    QUOTE_REQUESTED = "quote_requested"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    CONFIRMED = "confirmed"
    ASSIGNED = "assigned"
    ACCEPTED = "accepted"
    COLLECTED = "collected"
    EN_ROUTE = "en_route"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    FAILED = "failed"
    DISPUTED = "disputed"


# Shared by both tables. VARCHAR plus a CHECK constraint rather than a native
# PostgreSQL enum (same choice as users.role), so adding a status later is a
# constraint change in a migration.
def _status_enum(name: str) -> Enum:
    return Enum(
        OrderStatus,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=30,
        values_callable=lambda statuses: [status.value for status in statuses],
    )


class Order(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A customer's water order request.

    Attributes:
        reference: Public, non-guessable reference such as ``MO-7KQ2M9XH4T``
            (FR-027). Unique. Used in URLs instead of ``id``.
        customer_id: The ordering customer (``users.id``). Customers may only
            read their own orders (FR-001). Users with orders cannot be deleted.
        idempotency_key: Client-generated UUID, one per checkout attempt. Unique
            per customer, so retries cannot create a second order (FR-026,
            NFR-011).
        status: Current :class:`OrderStatus`.
        quantity_litres: Requested quantity, 1-100000 whole litres. Every
            quantity is a manual quote request in Sprint 1 (FR-021).
        contact_name: Person receiving the delivery (FR-020).
        contact_phone: Their Nigerian mobile number in E.164 form.
        delivery_address: Free-text address (FR-020).
        landmark: Optional landmark.
        delivery_instructions: Optional instructions.
        preferred_delivery_date: Optional preferred date (Africa/Lagos). A
            preference only, not a booked slot (FR-025 slots come later).
        is_simulated: True for demo/test data, which is excluded from real
            metrics (BR-09). Set only by server-side seed scripts.
    """

    __tablename__ = "orders"
    __table_args__ = (
        # FR-026: the database, not application code, guarantees that one
        # checkout attempt produces at most one order, even under concurrency.
        UniqueConstraint("customer_id", "idempotency_key", name="uq_orders_customer_idempotency"),
        CheckConstraint(
            f"quantity_litres BETWEEN {MIN_QUANTITY_LITRES} AND {MAX_QUANTITY_LITRES}",
            name="quantity_litres_range",
        ),
        # A customer's order list, newest first.
        Index("ix_orders_customer_id_created_at", "customer_id", "created_at"),
        # The dispatcher queue filters by status and creation date (FR-030).
        Index("ix_orders_status_created_at", "status", "created_at"),
    )

    reference: Mapped[str] = mapped_column(String(REFERENCE_LENGTH), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    idempotency_key: Mapped[uuid.UUID]
    status: Mapped[OrderStatus] = mapped_column(_status_enum("order_status"))
    quantity_litres: Mapped[int]
    contact_name: Mapped[str] = mapped_column(String(CONTACT_NAME_MAX_LENGTH))
    contact_phone: Mapped[str] = mapped_column(String(16))
    delivery_address: Mapped[str] = mapped_column(String(DELIVERY_ADDRESS_MAX_LENGTH))
    landmark: Mapped[str | None] = mapped_column(String(LANDMARK_MAX_LENGTH))
    delivery_instructions: Mapped[str | None] = mapped_column(
        String(DELIVERY_INSTRUCTIONS_MAX_LENGTH)
    )
    preferred_delivery_date: Mapped[date | None]
    is_simulated: Mapped[bool] = mapped_column(default=False, server_default=false())


class OrderEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One status change of an order, kept as an audit trail (NFR-004).

    Rows are append-only: they are never updated or deleted, and an order with
    events cannot be deleted.

    Attributes:
        order_id: The order that changed.
        actor_id: User who caused the change, or null for a system action.
        from_status: Previous status; null when the order was created.
        to_status: New status.
        reason: Why the change happened, where one is required (for example a
            cancellation, FR-036). Null otherwise.
    """

    __tablename__ = "order_events"

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    from_status: Mapped[OrderStatus | None] = mapped_column(_status_enum("order_event_from_status"))
    to_status: Mapped[OrderStatus] = mapped_column(_status_enum("order_event_to_status"))
    reason: Mapped[str | None] = mapped_column(Text)
