"""SMS provider adapters (FR-003). No network: Termii is reached through a mock transport."""

import json

import httpx2
import pytest

from app.core.config import Settings
from app.modules.messaging.sms import (
    MockSmsProvider,
    SmsDeliveryError,
    SmsDeliveryStatus,
    SmsFailureReason,
    TermiiSmsProvider,
    build_sms_provider,
    mask_phone,
)

API_KEY = "test-key-not-real"


def termii(handler: httpx2.MockTransport) -> TermiiSmsProvider:
    return TermiiSmsProvider(
        base_url="https://api.ng.termii.com",
        api_key=API_KEY,
        sender_id="MmiriOma",
        channel="dnd",
        timeout_seconds=5,
        transport=handler,
    )


@pytest.mark.anyio
async def test_mock_provider_records_and_can_fail() -> None:
    provider = MockSmsProvider()
    await provider.send(phone="+2348000000001", text="hello")
    assert [(sms.phone, sms.text) for sms in provider.outbox] == [("+2348000000001", "hello")]

    provider.fail = True
    with pytest.raises(SmsDeliveryError):
        await provider.send(phone="+2348000000001", text="again")
    assert len(provider.outbox) == 1


@pytest.mark.anyio
async def test_termii_sends_the_documented_payload() -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json={"code": "ok", "message_id": "123"})

    await termii(httpx2.MockTransport(handler)).send(phone="+2348000000001", text="Code 123456")

    assert str(requests[0].url) == "https://api.ng.termii.com/api/sms/send"
    assert json.loads(requests[0].content) == {
        "api_key": API_KEY,
        "to": "2348000000001",  # international digits, no "+"
        "from": "MmiriOma",
        "sms": "Code 123456",
        "type": "plain",
        "channel": "dnd",
    }


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(401, json={"message": "Invalid API key"}),
        httpx2.Response(200, json={"code": "error", "message": "Insufficient balance"}),
        httpx2.Response(200, text="<html>gateway</html>"),
    ],
)
async def test_termii_failures_raise_without_secrets(response: httpx2.Response) -> None:
    provider = termii(httpx2.MockTransport(lambda _: response))
    with pytest.raises(SmsDeliveryError) as raised:
        await provider.send(phone="+2348000000001", text="Code 123456")
    assert API_KEY not in str(raised.value)
    assert "123456" not in str(raised.value)


@pytest.mark.anyio
async def test_termii_network_error_raises() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down", request=request)

    with pytest.raises(SmsDeliveryError, match="ConnectError"):
        await termii(httpx2.MockTransport(handler)).send(phone="+2348000000001", text="x")


def test_provider_is_chosen_by_settings() -> None:
    base = {"database_url": "postgresql+asyncpg://u:p@localhost/db"}
    mock = Settings(_env_file=None, **base)  # type: ignore[call-arg]
    real = Settings(  # type: ignore[call-arg]
        _env_file=None,
        **base,
        sms_provider="termii",
        termii_api_key=API_KEY,
        termii_sender_id="MmiriOma",
    )
    assert isinstance(build_sms_provider(mock), MockSmsProvider)
    assert isinstance(build_sms_provider(real), TermiiSmsProvider)


def test_mask_phone_hides_the_middle() -> None:
    assert mask_phone("+2348000000001") == "+234800****001"
    assert mask_phone("123") == "****"


# Real prefixes of each network (MTN 0803, Airtel 0802/0701, Glo 0805/0705, 9mobile 0809),
# written the three ways people type them. Termii must always get 234 + 10 digits.
NETWORK_NUMBERS = [
    ("MTN", "08031234567"),
    ("Airtel", "08021234567"),
    ("Airtel", "07011234567"),
    ("Glo", "08051234567"),
    ("Glo", "07051234567"),
    ("9mobile", "08091234567"),
]


@pytest.mark.anyio
@pytest.mark.parametrize(("network", "local"), NETWORK_NUMBERS)
@pytest.mark.parametrize("style", ["local", "plus", "bare", "plus_with_zero"])
async def test_every_network_gets_the_same_termii_number(
    network: str, local: str, style: str
) -> None:
    from app.shared.phone import normalize_nigerian_phone

    typed = {
        "local": local,
        "plus": "+234" + local[1:],
        "bare": "234" + local[1:],
        "plus_with_zero": "+234" + local,
    }[style]
    sent: list[dict[str, object]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        return httpx2.Response(200, json={"code": "ok", "message_id": "m1"})

    receipt = await termii(httpx2.MockTransport(handler)).send(
        phone=normalize_nigerian_phone(typed), text="Code 123456"
    )

    assert sent[0]["to"] == "234" + local[1:]
    assert receipt.message_id == "m1"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "phone", ["+23480312345", "+2347", "+12025550123", "08031234567", "+2346031234567"]
)
async def test_invalid_numbers_never_reach_termii(phone: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise AssertionError("no request should be made")

    with pytest.raises(SmsDeliveryError) as raised:
        await termii(httpx2.MockTransport(handler)).send(phone=phone, text="Code 123456")
    assert raised.value.reason is SmsFailureReason.INVALID_NUMBER


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx2.Response(400, json={"message": "Invalid Sender Id"}), SmsFailureReason.SENDER_ID),
        (
            httpx2.Response(200, json={"code": "error", "message": "Insufficient balance"}),
            SmsFailureReason.INSUFFICIENT_BALANCE,
        ),
        (
            httpx2.Response(403, json={"message": "You are not set up on this route"}),
            SmsFailureReason.ROUTE_NOT_ENABLED,
        ),
        (httpx2.Response(401, json={"message": "Unauthorized"}), SmsFailureReason.ACCOUNT_INACTIVE),
        (httpx2.Response(429, json={}), SmsFailureReason.RATE_LIMITED),
        (httpx2.Response(503, text="down"), SmsFailureReason.PROVIDER_UNAVAILABLE),
        (httpx2.Response(200, text="<html>gateway</html>"), SmsFailureReason.PROVIDER_UNAVAILABLE),
        (httpx2.Response(422, json={"message": "odd"}), SmsFailureReason.REJECTED),
    ],
)
async def test_termii_failures_carry_a_reason(
    response: httpx2.Response, reason: SmsFailureReason
) -> None:
    provider = termii(httpx2.MockTransport(lambda _: response))
    with pytest.raises(SmsDeliveryError) as raised:
        await provider.send(phone="+2348031234567", text="Code 123456")
    assert raised.value.reason is reason
    assert "123456" not in str(raised.value)
    assert API_KEY not in str(raised.value)


@pytest.mark.anyio
async def test_sending_logs_no_code_number_or_key(caplog: pytest.LogCaptureFixture) -> None:
    provider = termii(
        httpx2.MockTransport(
            lambda _: httpx2.Response(200, json={"code": "ok", "message_id": "m1"})
        )
    )
    with caplog.at_level("DEBUG"):
        await provider.send(phone="+2348031234567", text="Code 123456")
        provider = termii(httpx2.MockTransport(lambda _: httpx2.Response(401, json={})))
        with pytest.raises(SmsDeliveryError):
            await provider.send(phone="+2348031234567", text="Code 123456")
    logged = caplog.text
    assert "123456" not in logged
    assert API_KEY not in logged
    assert "2348031234567" not in logged


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("reported", "expected"),
    [
        ("Delivered", SmsDeliveryStatus.DELIVERED),
        ("Message Sent", SmsDeliveryStatus.ACCEPTED),
        ("DND Active on Phone Number", SmsDeliveryStatus.FAILED),
        ("Rejected", SmsDeliveryStatus.FAILED),
        ("Message Failed", SmsDeliveryStatus.FAILED),
        ("Expired", SmsDeliveryStatus.FAILED),
        ("Something New", SmsDeliveryStatus.ACCEPTED),
    ],
)
async def test_delivery_status_reads_termii_reports(
    reported: str, expected: SmsDeliveryStatus
) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json=[{"message_id": "m1", "status": reported}])

    assert await termii(httpx2.MockTransport(handler)).delivery_status("m1") is expected
    assert requests[0].url.path == "/api/sms/inbox"
    assert requests[0].url.params["message_id"] == "m1"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(500, text="down"),
        httpx2.Response(200, text="not json"),
        httpx2.Response(200, json=[]),
        httpx2.Response(200, json=[{"message_id": "other", "status": "Delivered"}]),
    ],
)
async def test_unreadable_reports_never_count_as_delivered(response: httpx2.Response) -> None:
    provider = termii(httpx2.MockTransport(lambda _: response))
    assert await provider.delivery_status("m1") is SmsDeliveryStatus.ACCEPTED
