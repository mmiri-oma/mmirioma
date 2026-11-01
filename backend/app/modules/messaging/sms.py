"""SMS sending through a configured provider (SRS v0.2 FR-003, FR-050).

Two providers, chosen with ``SMS_PROVIDER``:

- ``mock`` (development and test): sends nothing. It keeps the messages in
  memory (tests read :attr:`MockSmsProvider.outbox`) and logs them on this
  machine with the phone number masked, so a developer can read a
  verification code from the backend console. Production refuses to start
  with it (``core/config.py``), because customers must never be told a code
  was sent when it was not.
- ``termii``: Termii's messaging API, ``POST {TERMII_BASE_URL}/api/sms/send``
  (https://developers.termii.com/messaging-api, checked 2026-10-17). The
  ``dnd`` channel is Termii's recommended route for OTPs; it reaches numbers
  on Nigeria's Do-Not-Disturb list and must be activated on the account.

A failed send raises :class:`SmsDeliveryError`, which carries a
:class:`SmsFailureReason` so operators can tell a Sender ID or route problem
from an empty wallet. Callers decide what that means; for verification codes
it means nothing is claimed as sent.

**Accepted is not delivered.** Termii answering ``"code": "ok"`` only means it
took the message for the carrier. Delivery is reported later, per message, by
Termii's history endpoint (``GET /api/sms/inbox?message_id=``, checked
2026-10-31): ``Delivered``, or a failure such as ``DND Active on Phone Number``,
``Rejected``, ``Message Failed`` or ``Expired``. :meth:`SmsProvider.send`
returns the provider's message id and :meth:`SmsProvider.delivery_status` reads
that report, so callers never present "accepted" as "delivered".

Message text may contain one-time codes, so it is never logged by the Termii
provider and the API key is never logged at all.
"""

import logging
import re
from dataclasses import dataclass, field
from enum import StrEnum
from functools import cache
from typing import Protocol

import httpx2

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class SmsFailureReason(StrEnum):
    """Why a message was not accepted, for logs and operators.

    Attributes:
        INVALID_NUMBER: The number is not a Nigerian mobile number.
        SENDER_ID: Termii reports an invalid or unapproved Sender ID.
        ROUTE_NOT_ENABLED: The account is not set up on the route or service
            (for example ``dnd`` not activated). Needs Termii to enable it.
        INSUFFICIENT_BALANCE: The Termii wallet is empty.
        ACCOUNT_INACTIVE: The account or API key is not allowed to send.
        RATE_LIMITED: Termii answered 429.
        PROVIDER_UNAVAILABLE: Network error, timeout, 5xx or an unreadable answer.
        REJECTED: Any other refusal.
    """

    INVALID_NUMBER = "invalid_number"
    SENDER_ID = "sender_id"
    ROUTE_NOT_ENABLED = "route_not_enabled"
    INSUFFICIENT_BALANCE = "insufficient_balance"
    ACCOUNT_INACTIVE = "account_inactive"
    RATE_LIMITED = "rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    REJECTED = "rejected"


class SmsDeliveryError(Exception):
    """The provider did not accept the message. The message is safe to log.

    Attributes:
        reason: Why, as a :class:`SmsFailureReason`.
    """

    def __init__(self, message: str, reason: SmsFailureReason = SmsFailureReason.REJECTED) -> None:
        super().__init__(message)
        self.reason = reason


class SmsDeliveryStatus(StrEnum):
    """What is known about a message the provider accepted.

    Attributes:
        ACCEPTED: The provider took it; no delivery report yet. Not proof of
            receipt.
        DELIVERED: The carrier reported it reached the handset.
        FAILED: The carrier or provider reported it did not arrive (DND,
            rejected, expired or failed).
    """

    ACCEPTED = "accepted"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass(frozen=True)
class SmsReceipt:
    """What the provider returned for an accepted message.

    Attributes:
        message_id: The provider's id, used to read the delivery report later.
            ``None`` when the provider gave none.
    """

    message_id: str | None


class SmsProvider(Protocol):
    """Something that can send one SMS and report on it."""

    async def send(self, *, phone: str, text: str) -> SmsReceipt:
        """Send ``text`` to ``phone`` (E.164).

        Returns:
            The receipt. "Accepted" only: use :meth:`delivery_status` to learn
            whether it arrived.

        Raises:
            SmsDeliveryError: If the message was not accepted.
        """
        ...

    async def delivery_status(self, message_id: str) -> SmsDeliveryStatus:
        """Read the provider's delivery report for an accepted message.

        Never raises: when the report cannot be read, the answer is
        :attr:`SmsDeliveryStatus.ACCEPTED` (unknown), never ``DELIVERED``.
        """
        ...


def mask_phone(phone: str) -> str:
    """Hide the middle of a phone number for logs (``+234800****001``).

    Args:
        phone: Number in E.164 form.

    Returns:
        The number with all but the first 7 and last 3 characters masked.
    """
    if len(phone) <= 10:
        return "****"
    return phone[:7] + "*" * (len(phone) - 10) + phone[-3:]


@dataclass(frozen=True)
class SentSms:
    """One message recorded by the mock provider."""

    phone: str
    text: str


@dataclass
class MockSmsProvider:
    """Development and test provider: records and logs messages, sends nothing.

    Attributes:
        outbox: Messages "sent" so far, oldest first.
        fail: When True, :meth:`send` raises, to test provider outages.
        fail_reason: The reason carried by that failure.
        status: What :meth:`delivery_status` answers, so tests can play a
            delivery report (a mock sends nothing, so by default it is
            ``DELIVERED`` to keep local verification flowing).
    """

    outbox: list[SentSms] = field(default_factory=list)
    fail: bool = False
    fail_reason: SmsFailureReason = SmsFailureReason.PROVIDER_UNAVAILABLE
    status: SmsDeliveryStatus = SmsDeliveryStatus.DELIVERED

    async def send(self, *, phone: str, text: str) -> SmsReceipt:
        """Record the message and log it locally.

        Raises:
            SmsDeliveryError: If :attr:`fail` is set.
        """
        if self.fail:
            raise SmsDeliveryError("Mock SMS provider set to fail", self.fail_reason)
        self.outbox.append(SentSms(phone=phone, text=text))
        # Development only (production cannot select this provider): the text
        # is logged so a developer can complete verification locally.
        logger.warning("MOCK SMS (not sent) to %s: %s", mask_phone(phone), text)
        return SmsReceipt(message_id=f"mock-{len(self.outbox)}")

    async def delivery_status(self, message_id: str) -> SmsDeliveryStatus:
        """Return :attr:`status`."""
        return self.status


# Termii wants 234 + a 10-digit mobile number starting 7, 8 or 9, no "+".
_TERMII_NUMBER = re.compile(r"234[789]\d{9}")

# Statuses of Termii's delivery reports that mean the message did not arrive
# (https://developers.termii.com/events-and-reports, checked 2026-10-31).
_FAILED_STATUSES = frozenset(
    {
        "failed",
        "message failed",
        "rejected",
        "expired",
        "dnd active on phone number",
        "dnd active on phone",
    }
)


def _json_object(response: httpx2.Response) -> dict[str, object] | None:
    """Return the body as a JSON object, or ``None`` if it is anything else."""
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _failure_reason(status_code: int, body: dict[str, object] | None) -> SmsFailureReason:
    """Classify a refusal from Termii's documented error messages.

    Termii lists its messages but not which HTTP status carries which
    (https://developers.termii.com/error, checked 2026-10-31), so the message
    text is matched first and the status code second. The text is only matched,
    never logged.
    """
    text = str(body.get("message", "")).lower() if body else ""
    if "sender id" in text:
        return SmsFailureReason.SENDER_ID
    if "insufficient balance" in text:
        return SmsFailureReason.INSUFFICIENT_BALANCE
    if "not set up on this route" in text or "service is currently not active" in text:
        return SmsFailureReason.ROUTE_NOT_ENABLED
    if "account is not active" in text or status_code in (401, 403):
        return SmsFailureReason.ACCOUNT_INACTIVE
    if status_code == 429:
        return SmsFailureReason.RATE_LIMITED
    if status_code >= 500 or body is None or "unavailable" in text:
        return SmsFailureReason.PROVIDER_UNAVAILABLE
    return SmsFailureReason.REJECTED


class TermiiSmsProvider:
    """Sends SMS through Termii's messaging API.

    Args:
        base_url: Account base URL, without a trailing slash.
        api_key: Termii API key.
        sender_id: Registered sender ID.
        channel: ``dnd`` or ``generic``.
        timeout_seconds: Request timeout.
        transport: Optional httpx2 transport, for tests.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        sender_id: str,
        channel: str,
        timeout_seconds: float,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = f"{base_url}/api/sms/send"
        self._history_url = f"{base_url}/api/sms/inbox"
        self._api_key = api_key
        self._sender_id = sender_id
        self._channel = channel
        self._timeout = timeout_seconds
        self._transport = transport

    async def send(self, *, phone: str, text: str) -> SmsReceipt:
        """Send one plain-text SMS.

        Termii takes the number as digits in international form, without
        ``+``. Success is HTTP 2xx with ``"code": "ok"`` in the body, which
        means *accepted for the carrier*, not delivered.

        Returns:
            The receipt with Termii's ``message_id``.

        Raises:
            SmsDeliveryError: On a number that is not a Nigerian mobile (no
                request is made), a network error, a non-2xx status or a body
                without ``"code": "ok"``. ``reason`` says which. The error and
                the log never include the text, the number or the API key.
        """
        digits = phone.removeprefix("+")
        if not _TERMII_NUMBER.fullmatch(digits):
            raise SmsDeliveryError(
                "Number is not a Nigerian mobile", SmsFailureReason.INVALID_NUMBER
            )
        payload = {
            "api_key": self._api_key,
            "to": digits,
            "from": self._sender_id,
            "sms": text,
            "type": "plain",
            "channel": self._channel,
        }
        try:
            async with httpx2.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.post(self._url, json=payload)
        except httpx2.HTTPError as exc:
            raise SmsDeliveryError(
                f"Termii request failed: {type(exc).__name__}",
                SmsFailureReason.PROVIDER_UNAVAILABLE,
            ) from exc
        body = _json_object(response)
        if not response.is_success or body is None or body.get("code") != "ok":
            reason = _failure_reason(response.status_code, body)
            raise SmsDeliveryError(f"Termii refused the message: {reason.value}", reason)
        message_id = body.get("message_id")
        logger.info(
            "SMS accepted by Termii for %s (message id %s, channel %s, balance %s)",
            mask_phone(phone),
            message_id,
            self._channel,
            body.get("balance"),
        )
        return SmsReceipt(message_id=str(message_id) if message_id else None)

    async def delivery_status(self, message_id: str) -> SmsDeliveryStatus:
        """Read Termii's delivery report for one message.

        Uses ``GET /api/sms/inbox?api_key=&message_id=``. Only an explicit
        ``Delivered`` counts as delivered and only the documented failure
        statuses (see :data:`_FAILED_STATUSES`) count as failed. Anything else
        (``Message Sent``, an unknown word, an unreadable answer or a network
        error) stays :attr:`SmsDeliveryStatus.ACCEPTED`, so a delivery is never
        invented. The report's text is never read or logged.
        """
        try:
            async with httpx2.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.get(
                    self._history_url,
                    params={"api_key": self._api_key, "message_id": message_id},
                )
            report = response.json() if response.is_success else None
        except httpx2.HTTPError, ValueError:
            return SmsDeliveryStatus.ACCEPTED
        records = report if isinstance(report, list) else [report]
        for record in records:
            if not isinstance(record, dict):
                continue
            if record.get("message_id") not in (None, message_id):
                continue
            status = str(record.get("status", "")).strip().lower()
            if status == "delivered":
                return SmsDeliveryStatus.DELIVERED
            if status in _FAILED_STATUSES:
                logger.warning("Termii reports message %s as %r", message_id, status)
                return SmsDeliveryStatus.FAILED
        return SmsDeliveryStatus.ACCEPTED


def build_sms_provider(settings: Settings) -> SmsProvider:
    """Create the provider selected by ``SMS_PROVIDER``.

    Args:
        settings: Validated settings; Termii settings are guaranteed present
            when ``termii`` is selected.

    Returns:
        The provider.
    """
    if settings.sms_provider == "termii":
        if settings.termii_api_key is None or settings.termii_sender_id is None:
            # Unreachable with validated Settings; kept so the types are exact.
            raise RuntimeError("Termii is selected but not configured")
        return TermiiSmsProvider(
            base_url=settings.termii_base_url,
            api_key=settings.termii_api_key.get_secret_value(),
            sender_id=settings.termii_sender_id,
            channel=settings.termii_channel,
            timeout_seconds=settings.sms_timeout_seconds,
        )
    return MockSmsProvider()


@cache
def get_sms_provider() -> SmsProvider:
    """FastAPI dependency returning the process-wide SMS provider.

    Tests override it with a :class:`MockSmsProvider` they can inspect.
    """
    return build_sms_provider(get_settings())
