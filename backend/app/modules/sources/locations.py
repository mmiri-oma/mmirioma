"""Water source pickup points (#385): the type and the read.

Kept apart from :mod:`app.modules.sources.service` so the order-fit check in
:mod:`app.modules.sources.eligibility` can read pickup points without
importing the service, which imports the eligibility module.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.sources.models import WaterSource


@dataclass(frozen=True)
class SourceLocation:
    """A source's pickup point, WGS 84 decimal degrees (#385)."""

    latitude: float
    longitude: float


async def source_locations(
    session: AsyncSession, source_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, SourceLocation]:
    """Read the pickup points of these sources.

    Args:
        session: Database session.
        source_ids: Source ids.

    Returns:
        The point by source id; a source with no point is absent.
    """
    ids = list(source_ids)
    if not ids:
        return {}
    point = cast(WaterSource.location, Geometry)
    rows = await session.execute(
        select(WaterSource.id, func.ST_Y(point), func.ST_X(point)).where(
            WaterSource.id.in_(ids), WaterSource.location.is_not(None)
        )
    )
    return {
        source_id: SourceLocation(latitude=float(latitude), longitude=float(longitude))
        for source_id, latitude, longitude in rows
    }
