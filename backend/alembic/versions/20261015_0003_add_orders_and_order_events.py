"""Add orders and order events (S1-03 order persistence).

Creates ``orders`` (price-less order requests, FR-020/FR-021) and
``order_events`` (append-only status history, NFR-004). See
docs/features/orders.md.

- ``uq_orders_customer_idempotency`` enforces FR-026: one order per customer
  and idempotency key, even under concurrent retries.
- ``uq_orders_reference`` keeps public references unique (FR-027).
- Status columns are VARCHAR plus a named CHECK constraint (as ``users.role``),
  so adding a status later only needs the constraint replaced. Autogenerate
  emitted each status CHECK twice; only the ``ck_*`` copy is kept (LOG.md,
  2026-10-14).
- Foreign keys use RESTRICT: orders and their history are business records and
  must not disappear when a user row is deleted.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-15 10:04:30.094487+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of OrderStatus at this revision. Migrations must not import app
# code that may change later.
ORDER_STATUSES = (
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
)
_STATUS_LIST = ", ".join(f"'{status}'" for status in ORDER_STATUSES)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("reference", sa.String(length=13), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("quantity_litres", sa.Integer(), nullable=False),
        sa.Column("contact_name", sa.String(length=100), nullable=False),
        sa.Column("contact_phone", sa.String(length=16), nullable=False),
        sa.Column("delivery_address", sa.String(length=500), nullable=False),
        sa.Column("landmark", sa.String(length=200), nullable=True),
        sa.Column("delivery_instructions", sa.String(length=500), nullable=True),
        sa.Column("preferred_delivery_date", sa.Date(), nullable=True),
        sa.Column("is_simulated", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(f"status IN ({_STATUS_LIST})", name=op.f("ck_orders_order_status")),
        sa.CheckConstraint(
            "quantity_litres BETWEEN 1 AND 100000", name=op.f("ck_orders_quantity_litres_range")
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["users.id"],
            name=op.f("fk_orders_customer_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_orders")),
        sa.UniqueConstraint(
            "customer_id", "idempotency_key", name="uq_orders_customer_idempotency"
        ),
        sa.UniqueConstraint("reference", name=op.f("uq_orders_reference")),
    )
    op.create_index(
        "ix_orders_customer_id_created_at", "orders", ["customer_id", "created_at"], unique=False
    )
    op.create_index("ix_orders_status_created_at", "orders", ["status", "created_at"], unique=False)

    op.create_table(
        "order_events",
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("from_status", sa.String(length=30), nullable=True),
        sa.Column("to_status", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            f"from_status IN ({_STATUS_LIST})",
            name=op.f("ck_order_events_order_event_from_status"),
        ),
        sa.CheckConstraint(
            f"to_status IN ({_STATUS_LIST})",
            name=op.f("ck_order_events_order_event_to_status"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_order_events_actor_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name=op.f("fk_order_events_order_id_orders"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_order_events")),
    )
    op.create_index(op.f("ix_order_events_actor_id"), "order_events", ["actor_id"], unique=False)
    op.create_index(op.f("ix_order_events_order_id"), "order_events", ["order_id"], unique=False)


def downgrade() -> None:
    # Drops all orders and their history. Acceptable only while no real pilot
    # data exists; once it does, downgrading past this revision needs a
    # reviewed plan.
    op.drop_index(op.f("ix_order_events_order_id"), table_name="order_events")
    op.drop_index(op.f("ix_order_events_actor_id"), table_name="order_events")
    op.drop_table("order_events")
    op.drop_index("ix_orders_status_created_at", table_name="orders")
    op.drop_index("ix_orders_customer_id_created_at", table_name="orders")
    op.drop_table("orders")
