"""Revocable current driver location (#410; agreed contract PR #423).

Downgrade deletes all current points and sharing grants. Restoring them is
impossible; after re-upgrade drivers must explicitly consent again.

Revision ID: 0029
Revises: 0028
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add opt-in grants and the private current-point table."""
    op.add_column(
        "driver_profiles",
        sa.Column("location_sharing_on", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "driver_profiles",
        sa.Column(
            "location_sharing_grant", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.create_check_constraint(
        op.f("ck_driver_profiles_location_sharing_grant_nonnegative"),
        "driver_profiles",
        "location_sharing_grant >= 0",
    )
    op.create_table(
        "driver_locations",
        sa.Column(
            "driver_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "location",
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("accuracy_metres", sa.Integer(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "accuracy_metres > 0", name=op.f("ck_driver_locations_accuracy_positive")
        ),
    )
    op.create_index(
        "ix_driver_locations_location", "driver_locations", ["location"], postgresql_using="gist"
    )


def downgrade() -> None:
    """Discard current points/grants; never attempt to restore withdrawn consent."""
    op.drop_index(
        "ix_driver_locations_location", table_name="driver_locations", postgresql_using="gist"
    )
    op.drop_table("driver_locations")
    op.drop_constraint(
        op.f("ck_driver_profiles_location_sharing_grant_nonnegative"),
        "driver_profiles",
        type_="check",
    )
    op.drop_column("driver_profiles", "location_sharing_grant")
    op.drop_column("driver_profiles", "location_sharing_on")
