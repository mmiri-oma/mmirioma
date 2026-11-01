"""The live SMS test command (#102): preview, guards and sending."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.modules.messaging import live_test
from app.modules.messaging.sms import MockSmsProvider, SmsDeliveryStatus, build_sms_provider

TEAM_PHONE_LOCAL = "08031234567"
TEAM_PHONE_E164 = "+2348031234567"
ALL_KEYS = [
    "verification_code",
    "order_confirmed",
    "dispatched",
    "delivery_code",
    "payment_received",
    "payment_part_paid",
]


@pytest.fixture
def termii_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pretend Termii is configured, without any real key."""
    monkeypatch.setattr(
        live_test,
        "get_settings",
        lambda: SimpleNamespace(app_env="development", sms_provider="termii"),
    )


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> MockSmsProvider:
    """Stand-in for Termii that records what would have been sent."""
    mock = MockSmsProvider()
    monkeypatch.setattr(live_test, "get_sms_provider", lambda: mock)
    return mock


def test_tests_use_the_mock_provider_whatever_the_local_env_says() -> None:
    # Regression: a developer's .env with SMS_PROVIDER=termii (set for the
    # live test) must not make the test suite send real SMS.
    get_settings.cache_clear()
    assert get_settings().sms_provider == "mock"
    assert isinstance(build_sms_provider(get_settings()), MockSmsProvider)


def test_sample_messages_cover_every_built_p0_message() -> None:
    messages = live_test.sample_messages(datetime(2026, 10, 23, 9, tzinfo=UTC))

    assert [message.key for message in messages] == ALL_KEYS


def test_sample_messages_are_one_sms_with_the_support_number_and_sample_values() -> None:
    messages = live_test.sample_messages(datetime(2026, 10, 23, 9, tzinfo=UTC))

    for message in messages:
        assert len(message.text) <= 160, message.key
        assert "Help: +234 813 377 4902" in message.text  # FR-055
        assert message.text.isascii(), message.key  # "N", not "₦": GSM-7, one SMS
    by_key = {message.key: message.text for message in messages}
    assert "123456" in by_key["verification_code"]
    assert "MO-SAMPLE0001" in by_key["order_confirmed"]
    assert "Sat 24 Oct 2026, 10:00 am to 12:00 pm" in by_key["order_confirmed"]
    assert "N15,000.00 is outstanding" in by_key["payment_part_paid"]
    assert "outstanding" not in by_key["payment_received"]


def test_preview_prints_every_message_and_sends_nothing(
    capsys: pytest.CaptureFixture[str], provider: MockSmsProvider
) -> None:
    assert live_test.main(["--to", TEAM_PHONE_LOCAL]) == 0

    output = capsys.readouterr().out
    assert "Preview only; nothing is sent." in output
    for key in ALL_KEYS:
        assert f"[{key}]" in output
    assert "[cancellation_outcome] not available" in output
    assert provider.outbox == []


def test_send_delivers_every_message_to_the_normalized_number(
    capsys: pytest.CaptureFixture[str], termii_settings: None, provider: MockSmsProvider
) -> None:
    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send"]) == 0

    expected = live_test.sample_messages(datetime.now(UTC))
    assert [sms.text for sms in provider.outbox] == [message.text for message in expected]
    assert {sms.phone for sms in provider.outbox} == {TEAM_PHONE_E164}
    output = capsys.readouterr().out
    assert output.count("accepted by Termii") == len(ALL_KEYS)
    assert TEAM_PHONE_E164 not in output  # masked


def test_check_delivery_prints_the_report_not_just_acceptance(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    termii_settings: None,
    provider: MockSmsProvider,
) -> None:
    monkeypatch.setattr(live_test.clock, "sleep", lambda _: None)
    provider.status = SmsDeliveryStatus.FAILED

    args = ["--to", TEAM_PHONE_LOCAL, "--send", "--only", "delivery_code", "--check-delivery", "1"]
    assert live_test.main(args) == 0

    output = capsys.readouterr().out
    assert "accepted by Termii; delivery report: failed" in output


def test_send_only_selected_messages(termii_settings: None, provider: MockSmsProvider) -> None:
    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send", "--only", "delivery_code"]) == 0

    assert len(provider.outbox) == 1
    assert "delivery code is 123456" in provider.outbox[0].text


def test_provider_failure_is_reported_as_not_accepted(
    capsys: pytest.CaptureFixture[str], termii_settings: None, provider: MockSmsProvider
) -> None:
    provider.fail = True

    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send"]) == 1

    output = capsys.readouterr().out
    assert "accepted by Termii" not in output
    assert output.count("NOT accepted: Mock SMS provider set to fail") == len(ALL_KEYS)


def test_send_refuses_the_mock_provider(
    capsys: pytest.CaptureFixture[str], provider: MockSmsProvider
) -> None:
    # The test environment uses SMS_PROVIDER=mock (conftest).
    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send"]) == 1

    assert "SMS_PROVIDER is mock" in capsys.readouterr().err
    assert provider.outbox == []


def test_refuses_to_run_in_production(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    provider: MockSmsProvider,
) -> None:
    monkeypatch.setattr(
        live_test,
        "get_settings",
        lambda: SimpleNamespace(app_env="production", sms_provider="termii"),
    )

    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send"]) == 1

    assert "outside production" in capsys.readouterr().err
    assert provider.outbox == []


@pytest.mark.parametrize(
    ("only", "error"),
    [
        ("cancellation_outcome", "no cancellation or refund SMS is built yet"),
        ("order_created", "Unknown message 'order_created'"),
    ],
)
def test_unknown_or_unbuilt_message_is_an_error(
    capsys: pytest.CaptureFixture[str],
    termii_settings: None,
    provider: MockSmsProvider,
    only: str,
    error: str,
) -> None:
    assert live_test.main(["--to", TEAM_PHONE_LOCAL, "--send", "--only", only]) == 1

    assert error in capsys.readouterr().err
    assert provider.outbox == []


def test_rejects_a_number_that_is_not_a_nigerian_mobile(
    capsys: pytest.CaptureFixture[str], termii_settings: None, provider: MockSmsProvider
) -> None:
    assert live_test.main(["--to", "12345", "--send"]) == 1

    assert "Nigerian mobile number" in capsys.readouterr().err
    assert provider.outbox == []
