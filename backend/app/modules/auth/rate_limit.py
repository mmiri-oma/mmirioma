"""In-memory rate limits for sign-in and registration (NFR-002).

Limits (sliding windows):

==========================  =============================  ===========
What                        Key                            Limit
==========================  =============================  ===========
Failed logins               phone number                   5 / 15 min
Failed logins               client IP                      50 / 15 min
Registrations (any result)  client IP                      20 / hour
==========================  =============================  ===========

Why these numbers: the per-phone limit is the real brute-force defence, so it is
strict. Many Nigerian mobile users share one public IP through carrier NAT, so
per-IP limits are generous: they stop one machine hammering many accounts or
mass-registering (which would also probe for registered phones) without
locking out a whole network. A successful login clears that phone's failures.

Every login attempt is counted when it **starts**, in the same synchronous step
as the check, and the count is withdrawn if the password turns out correct.
Counting only after the (slow, awaited) password check would let many
concurrent requests all pass the check before any failure was recorded.

Limitations, accepted for the single-process pilot (docs/features/authentication.md):

- State lives in this process. Restarting clears it, and running several
  workers or instances gives each its own counters (a shared store such as the
  database would be needed then).
- The IP is the direct peer address. Behind a reverse proxy, run uvicorn with
  ``--proxy-headers --forwarded-allow-ips=<proxy IP>`` or every client shares
  the proxy's address and limit.

All operations are synchronous with no ``await`` inside, so they are atomic on
the event loop without locks.
"""

import math
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from http import HTTPStatus

from app.core.errors import APIError

# Bounds memory under a flood of distinct keys; the least recently used are dropped.
MAX_KEYS_PER_LIMITER = 10_000


class SlidingWindowLimiter:
    """Counts events per key and refuses once ``limit`` occur within ``window_seconds``.

    Args:
        limit: Events allowed per window.
        window_seconds: Window length.
        clock: Monotonic time source; injectable for tests.
        max_keys: Keys tracked at most; least recently used are evicted.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_KEYS_PER_LIMITER,
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._events: OrderedDict[str, deque[float]] = OrderedDict()

    def _current(self, key: str) -> deque[float] | None:
        events = self._events.get(key)
        if events is None:
            return None
        cutoff = self._clock() - self.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def retry_after(self, key: str) -> int | None:
        """Return seconds until ``key`` may act again, or None if it may act now.

        Args:
            key: What is being limited (a phone number, an IP address).

        Returns:
            Whole seconds (at least 1) while limited, otherwise None.
        """
        events = self._current(key)
        if events is None or len(events) < self.limit:
            return None
        return max(1, math.ceil(events[0] + self.window_seconds - self._clock()))

    def hit(self, key: str) -> None:
        """Record one event for ``key``."""
        events = self._current(key)
        if events is None:
            events = deque()
            self._events[key] = events
        events.append(self._clock())
        self._events.move_to_end(key)
        while len(self._events) > self._max_keys:
            self._events.popitem(last=False)

    def undo(self, key: str) -> None:
        """Withdraw the most recent event for ``key`` (an attempt that succeeded)."""
        events = self._current(key)
        if events:
            events.pop()
            if not events:
                del self._events[key]

    def reset(self, key: str) -> None:
        """Forget all events for ``key``."""
        self._events.pop(key, None)

    def clear(self) -> None:
        """Forget everything (used by tests)."""
        self._events.clear()


def _too_many_attempts(retry_after: int) -> APIError:
    return APIError(
        HTTPStatus.TOO_MANY_REQUESTS,
        "too_many_attempts",
        "Too many attempts. Please wait and try again.",
        details={"retry_after_seconds": retry_after},
        headers={"Retry-After": str(retry_after)},
    )


@dataclass
class AuthRateLimits:
    """The limiters guarding the auth endpoints (limits in the module docstring)."""

    login_failures_by_phone: SlidingWindowLimiter = field(
        default_factory=lambda: SlidingWindowLimiter(limit=5, window_seconds=15 * 60)
    )
    login_failures_by_ip: SlidingWindowLimiter = field(
        default_factory=lambda: SlidingWindowLimiter(limit=50, window_seconds=15 * 60)
    )
    registrations_by_ip: SlidingWindowLimiter = field(
        default_factory=lambda: SlidingWindowLimiter(limit=20, window_seconds=60 * 60)
    )

    def begin_login(self, phone: str, ip: str) -> None:
        """Check the limits and count this attempt as a failure until it succeeds.

        Runs before the password is checked, so a limited caller learns
        nothing about the password, and registered and unknown phones get the
        same answer. Check and count happen with no ``await`` in between, so
        concurrent attempts cannot slip past the limit (see module docs).

        Args:
            phone: Normalized phone being signed in to.
            ip: Client IP address.

        Raises:
            APIError: 429 ``too_many_attempts`` with ``Retry-After``.
        """
        waits = [
            self.login_failures_by_phone.retry_after(phone),
            self.login_failures_by_ip.retry_after(ip),
        ]
        longest = max((wait for wait in waits if wait is not None), default=None)
        if longest is not None:
            raise _too_many_attempts(longest)
        self.login_failures_by_phone.hit(phone)
        self.login_failures_by_ip.hit(ip)

    def login_succeeded(self, phone: str, ip: str) -> None:
        """Clear the phone's failures and withdraw this attempt from the IP count.

        Only this attempt is withdrawn from the IP, so one valid account cannot
        be used to reset an IP that is guessing other accounts' passwords.
        """
        self.login_failures_by_phone.reset(phone)
        self.login_failures_by_ip.undo(ip)

    def check_and_record_registration(self, ip: str) -> None:
        """Count a registration attempt, refusing it once the IP is over its limit.

        Raises:
            APIError: 429 ``too_many_attempts`` with ``Retry-After``.
        """
        wait = self.registrations_by_ip.retry_after(ip)
        if wait is not None:
            raise _too_many_attempts(wait)
        self.registrations_by_ip.hit(ip)

    def clear(self) -> None:
        """Reset every limiter (used by tests)."""
        self.login_failures_by_phone.clear()
        self.login_failures_by_ip.clear()
        self.registrations_by_ip.clear()


_auth_rate_limits = AuthRateLimits()


def get_auth_rate_limits() -> AuthRateLimits:
    """FastAPI dependency returning the process-wide auth limiters."""
    return _auth_rate_limits
