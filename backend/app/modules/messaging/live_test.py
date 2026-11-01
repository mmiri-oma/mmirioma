"""Send every P0 SMS template to a team phone, to prove live SMS (#102).

Production SMS must be tested on real phones before the pilot (FR-003,
FR-050). This command builds each P0 message with the same functions the app
uses, filled with sample values that are labelled as samples (reference
``MO-SAMPLE0001``, code ``123456``), and sends them to one number. Run from
``backend/`` with the virtualenv active::

    python -m app.modules.messaging.live_test --to 08031234567            # preview, sends nothing
    python -m app.modules.messaging.live_test --to 08031234567 --send     # sends with Termii
    python -m app.modules.messaging.live_test --to 08031234567 --send --only delivery_code

Rules:

- It refuses to run with ``APP_ENV=production``: the live test is a
  non-production run (#102) and never touches production data. It reads no
  database at all.
- ``--send`` requires ``SMS_PROVIDER=termii`` with its key and sender ID in
  the local ``.env`` (never in the repository). With the mock provider
  nothing would reach the phone, so it refuses instead of reporting a send.
- "Accepted" means Termii accepted the request, not that the phone received
  it. Whoever holds the phone records what arrived (``docs/process/
  pilot-plan.md``, "SMS live test record").

The cancellation and refund outcome SMS (FR-043, FR-044) is not built: for
the pilot an administrator sends it manually (pilot plan fallback F10), so it
is listed as not available rather than sent.
"""

import argparse
import asyncio
import sys
import time as clock
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, time, timedelta

from app.core.config import get_settings
from app.core.log_config import configure_logging
from app.modules.auth import phone_verification
from app.modules.confirmation.service import confirmation_message
from app.modules.deliveries import codes as delivery_codes
from app.modules.deliveries.service import dispatched_message
from app.modules.messaging.sms import (
    SmsDeliveryError,
    SmsDeliveryStatus,
    SmsProvider,
    get_sms_provider,
    mask_phone,
)
from app.modules.payments.service import payment_message
from app.shared.lagos_time import LAGOS_TZ
from app.shared.phone import normalize_nigerian_phone

SAMPLE_REFERENCE = "MO-SAMPLE0001"
SAMPLE_CODE = "123456"
SAMPLE_TOTAL_MINOR_UNITS = 4_500_000  # N45,000.00
SAMPLE_PART_PAYMENT_MINOR_UNITS = 3_000_000  # N30,000.00, leaving N15,000.00

NOT_BUILT: dict[str, str] = {
    "cancellation_outcome": (
        "FR-043, FR-044: no cancellation or refund SMS is built yet; "
        "an administrator sends it manually (pilot plan fallback F10)"
    ),
}


@dataclass(frozen=True)
class LiveTestMessage:
    """One P0 message to send.

    Attributes:
        key: Name used with ``--only`` and in the record.
        requirement: The SRS requirement the message serves.
        text: The exact text the app would send, with sample values.
    """

    key: str
    requirement: str
    text: str


@dataclass(frozen=True)
class SendResult:
    """What the provider said about one message.

    Attributes:
        key: The message's key.
        sent_at: When the request was made (UTC).
        error: ``None`` if the provider accepted it, else the provider error,
            which never contains the text or the API key.
        message_id: The provider's message id when it accepted the message.
        delivery: The provider's delivery report, once read with
            ``--check-delivery``; ``None`` until then.
    """

    key: str
    sent_at: datetime
    error: str | None
    message_id: str | None = None
    delivery: SmsDeliveryStatus | None = None

    @property
    def accepted(self) -> bool:
        """Whether the provider accepted the message (not proof of receipt)."""
        return self.error is None


def sample_messages(now: datetime) -> list[LiveTestMessage]:
    """Build every built P0 message with sample values.

    Each text comes from the function the app itself calls, so a change to a
    template changes what this command sends.

    Args:
        now: The current time; the sample window is tomorrow, 10 am to
            12 pm in Lagos.

    Returns:
        The messages, in the order a customer meets them.
    """
    tomorrow = now.astimezone(LAGOS_TZ).date() + timedelta(days=1)
    window_start = datetime.combine(tomorrow, time(10), LAGOS_TZ).astimezone(UTC)
    window_end = window_start + timedelta(hours=2)
    return [
        LiveTestMessage(
            "verification_code", "FR-003", phone_verification.code_message(SAMPLE_CODE)
        ),
        LiveTestMessage(
            "order_confirmed",
            "FR-050",
            confirmation_message(
                reference=SAMPLE_REFERENCE,
                window_start_at=window_start,
                window_end_at=window_end,
                total_minor_units=SAMPLE_TOTAL_MINOR_UNITS,
            ),
        ),
        LiveTestMessage("dispatched", "FR-050", dispatched_message(SAMPLE_REFERENCE)),
        LiveTestMessage("delivery_code", "FR-035", delivery_codes.code_message(SAMPLE_CODE)),
        LiveTestMessage(
            "payment_received",
            "FR-041",
            payment_message(
                reference=SAMPLE_REFERENCE,
                amount_minor_units=SAMPLE_TOTAL_MINOR_UNITS,
                outstanding_minor_units=0,
            ),
        ),
        LiveTestMessage(
            "payment_part_paid",
            "FR-041",
            payment_message(
                reference=SAMPLE_REFERENCE,
                amount_minor_units=SAMPLE_PART_PAYMENT_MINOR_UNITS,
                outstanding_minor_units=(
                    SAMPLE_TOTAL_MINOR_UNITS - SAMPLE_PART_PAYMENT_MINOR_UNITS
                ),
            ),
        ),
    ]


async def send_messages(
    provider: SmsProvider, *, phone: str, messages: Sequence[LiveTestMessage]
) -> list[SendResult]:
    """Send each message in turn; one failure does not stop the others.

    Args:
        provider: The configured SMS provider.
        phone: Recipient in E.164 form.
        messages: What to send.

    Returns:
        One result per message, in order.
    """
    results: list[SendResult] = []
    for message in messages:
        sent_at = datetime.now(UTC)
        try:
            receipt = await provider.send(phone=phone, text=message.text)
            results.append(SendResult(message.key, sent_at, None, receipt.message_id))
        except SmsDeliveryError as exc:
            results.append(SendResult(message.key, sent_at, str(exc)))
    return results


async def read_delivery(provider: SmsProvider, results: Sequence[SendResult]) -> list[SendResult]:
    """Attach the provider's delivery report to each accepted message.

    This is how the team tells "accepted" from "delivered" per network: send to
    an MTN, an Airtel and a Glo phone, then compare the reports.

    Args:
        provider: The configured SMS provider.
        results: Results from :func:`send_messages`.

    Returns:
        The same results with ``delivery`` filled in for accepted messages.
    """
    updated: list[SendResult] = []
    for result in results:
        if result.message_id is None:
            updated.append(result)
            continue
        status = await provider.delivery_status(result.message_id)
        updated.append(replace(result, delivery=status))
    return updated


def _select(messages: list[LiveTestMessage], only: str | None) -> list[LiveTestMessage]:
    if only is None:
        return messages
    wanted = [key.strip() for key in only.split(",") if key.strip()]
    known = {message.key for message in messages}
    for key in wanted:
        if key in NOT_BUILT:
            raise ValueError(f"{key} cannot be sent: {NOT_BUILT[key]}.")
        if key not in known:
            raise ValueError(f"Unknown message {key!r}. Choose from: {', '.join(sorted(known))}.")
    return [message for message in messages if message.key in wanted]


def _print_preview(messages: Sequence[LiveTestMessage]) -> None:
    for message in messages:
        print(f"[{message.key}] ({message.requirement}, {len(message.text)} characters)")
        print(f"  {message.text}")
    for key, reason in NOT_BUILT.items():
        print(f"[{key}] not available: {reason}")


def _print_results(results: Sequence[SendResult], phone: str) -> None:
    print(f"Sent to {mask_phone(phone)}. Record what the phone receives in the pilot plan.")
    for result in results:
        when = result.sent_at.astimezone(LAGOS_TZ).strftime("%Y-%m-%d %H:%M:%S WAT")
        outcome = "accepted by Termii" if result.accepted else f"NOT accepted: {result.error}"
        if result.delivery is not None:
            outcome += f"; delivery report: {result.delivery.value}"
        if result.message_id:
            outcome += f" (id {result.message_id})"
        print(f"  {when}  {result.key:<18} {outcome}")


def main(argv: list[str] | None = None) -> int:
    """Preview or send the P0 messages to one phone.

    Args:
        argv: Arguments without the program name; defaults to ``sys.argv[1:]``.

    Returns:
        0 when everything selected was previewed or accepted, 1 on an error
        or if any message was not accepted.
    """
    parser = argparse.ArgumentParser(
        prog="python -m app.modules.messaging.live_test",
        description="Send every P0 SMS template, with sample values, to one team phone.",
    )
    parser.add_argument("--to", required=True, help="Nigerian mobile number of a team phone")
    parser.add_argument("--send", action="store_true", help="send (default: preview only)")
    parser.add_argument("--only", help="comma-separated message keys (default: all)")
    parser.add_argument(
        "--check-delivery",
        type=int,
        metavar="SECONDS",
        help="after sending, wait this long, then read Termii's delivery report for each message",
    )
    args = parser.parse_args(argv)

    try:
        settings = get_settings()
        if settings.app_env == "production":
            raise ValueError("The live SMS test runs outside production (APP_ENV=production).")
        phone = normalize_nigerian_phone(args.to)
        messages = _select(sample_messages(datetime.now(UTC)), args.only)
        if not args.send:
            print("Preview only; nothing is sent. Add --send to send with Termii.")
            _print_preview(messages)
            return 0
        if settings.sms_provider != "termii":
            raise ValueError(
                "SMS_PROVIDER is mock, which sends nothing. Set SMS_PROVIDER=termii "
                "with TERMII_API_KEY and TERMII_SENDER_ID in your local .env."
            )
        # Shows Termii's message ID for each accepted message (masked phone).
        configure_logging()
        provider = get_sms_provider()
        results = asyncio.run(send_messages(provider, phone=phone, messages=messages))
        if args.check_delivery is not None:
            clock.sleep(max(0, args.check_delivery))  # CLI only, never in a request handler
            results = asyncio.run(read_delivery(provider, results))
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    _print_results(results, phone)
    return 0 if all(result.accepted for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
