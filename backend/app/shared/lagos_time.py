"""Calendar dates in Africa/Lagos, the time zone the service operates in (SRS §2.1).

API calendar dates (``YYYY-MM-DD``) mean the date in Lagos (docs/api/README.md,
"Formats"), while timestamps are stored in UTC.

Lagos uses West Africa Time, a fixed UTC+1 with no daylight saving, so a fixed
offset is exact. It also avoids depending on a time zone database, which slim
container images and Windows may not ship.
"""

from datetime import UTC, date, datetime, time, timedelta, timezone

LAGOS_TZ = timezone(timedelta(hours=1), "WAT")


def lagos_today() -> date:
    """Return today's date in Lagos."""
    return datetime.now(UTC).astimezone(LAGOS_TZ).date()


def lagos_day_start_utc(day: date) -> datetime:
    """Return the UTC instant at which ``day`` begins in Lagos.

    Args:
        day: A calendar date in Lagos.

    Returns:
        Midnight Lagos time on ``day``, as an aware UTC datetime
        (23:00 UTC on the previous day).
    """
    return datetime.combine(day, time.min, LAGOS_TZ).astimezone(UTC)
