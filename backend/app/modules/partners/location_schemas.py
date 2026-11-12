"""Private driver location request and coordinate-free response schemas (#410)."""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.shared.location import Location, LocationSource


class DriverPoint(BaseModel):
    """Device coordinates validated with the existing delivery bounds (FR-031)."""

    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_bounds(self) -> Self:
        """Apply the shared bounds and six-decimal storage precision."""
        point = Location(
            latitude=self.latitude,
            longitude=self.longitude,
            source=LocationSource.DEVICE_LOCATION,
        )
        self.latitude, self.longitude = point.latitude, point.longitude
        return self


class DriverLocationUpdate(BaseModel):
    """A device point tied to the server's current consent grant."""

    model_config = ConfigDict(extra="forbid")
    location: DriverPoint
    accuracy_metres: float = Field(gt=0, le=100_000, allow_inf_nan=False, strict=True)
    grant: int = Field(ge=1, strict=True)


class SharingGrantRead(BaseModel):
    """A new grant, returned only after explicit consent."""

    grant: int


class DriverLocationRead(BaseModel):
    """Location age and sharing state, without a point or grant."""

    state: Literal["fresh", "stale", "none"] = "none"
    sharing: bool = False
    confirmed_at: datetime | None = None
    fresh_until: datetime | None = None
    accuracy_metres: int | None = None
