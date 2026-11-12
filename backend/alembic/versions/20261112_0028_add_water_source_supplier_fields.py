"""Water source supplier details and order fit (#407).

docs/api/admin-water-sources.md, "Amendment #407" (agreed 2026-11-12, PR #417).

- ``water_sources``: ``contact_name`` and ``contact_phone`` (supplier contact,
  personal data, admin-only), ``min_litres_per_order`` and
  ``max_litres_per_order`` (the order sizes the supplier agreed to, D14),
  ``is_available`` and the allowed vehicles ``serves_keke`` and
  ``serves_tanker``.
- CHECKs: each litre limit at least 1, the minimum not above the maximum,
  and at least one vehicle.
- A GiST index on the existing ``location`` geography point, for the
  nearest-source lookups of #408 and #411.

Every new column is nullable or has a server default, so existing rows stay
valid: no contact, no limits, available, both vehicles. No data is rewritten.

**Downgrade loses data.** It drops the new columns, and with them every
supplier contact, litre limit, availability flag and vehicle choice entered
since. Back up ``water_sources`` before rolling back; the upgrade cannot bring
the values back.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-12 18:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "water_sources"
CHECKS = {
    "min_litres_positive": "min_litres_per_order IS NULL OR min_litres_per_order >= 1",
    "max_litres_positive": "max_litres_per_order IS NULL OR max_litres_per_order >= 1",
    "min_litres_not_above_max": (
        "min_litres_per_order IS NULL OR max_litres_per_order IS NULL"
        " OR min_litres_per_order <= max_litres_per_order"
    ),
    "serves_a_vehicle": "serves_keke OR serves_tanker",
}


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("contact_name", sa.String(length=120), nullable=True))
    op.add_column(TABLE, sa.Column("contact_phone", sa.String(length=16), nullable=True))
    op.add_column(TABLE, sa.Column("min_litres_per_order", sa.Integer(), nullable=True))
    op.add_column(TABLE, sa.Column("max_litres_per_order", sa.Integer(), nullable=True))
    for column in ("is_available", "serves_keke", "serves_tanker"):
        op.add_column(
            TABLE, sa.Column(column, sa.Boolean(), server_default=sa.true(), nullable=False)
        )
    for name, condition in CHECKS.items():
        op.create_check_constraint(op.f(f"ck_{TABLE}_{name}"), TABLE, condition)
    op.create_index(
        "ix_water_sources_location", TABLE, ["location"], unique=False, postgresql_using="gist"
    )


def downgrade() -> None:
    op.drop_index("ix_water_sources_location", table_name=TABLE, postgresql_using="gist")
    for name in CHECKS:
        op.drop_constraint(op.f(f"ck_{TABLE}_{name}"), TABLE, type_="check")
    for column in (
        "serves_tanker",
        "serves_keke",
        "is_available",
        "max_litres_per_order",
        "min_litres_per_order",
        "contact_phone",
        "contact_name",
    ):
        op.drop_column(TABLE, column)
