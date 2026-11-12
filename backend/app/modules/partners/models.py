"""One current private driver point, never a location history (#410, FR-031)."""

import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import CheckConstraint, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base


class DriverLocation(Base):
    """The latest point of a consenting online driver; coordinates stay server-side.

    The driver's user UUID is the primary key: confirming overwrites this row.
    Clearing paths delete it and invalidate the profile's sharing grant.
    """

    __tablename__ = "driver_locations"
    __table_args__ = (
        CheckConstraint("accuracy_metres > 0", name="accuracy_positive"),
        Index("ix_driver_locations_location", "location", postgresql_using="gist"),
    )

    driver_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    location: Mapped[Any] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    accuracy_metres: Mapped[int]
    confirmed_at: Mapped[datetime]
