import pytest

from app.shared.phone import format_phone_national, normalize_nigerian_phone


@pytest.mark.parametrize(
    "raw",
    [
        "08000000001",
        "2348000000001",
        "+2348000000001",
        "+234 800 000 0001",
        "0800-000-0001",
        "(0800) 000.0001",
        "8000000001",
    ],
)
def test_normalizes_accepted_formats(raw: str) -> None:
    assert normalize_nigerian_phone(raw) == "+2348000000001"


@pytest.mark.parametrize("prefix", ["07", "08", "09"])
def test_accepts_mobile_ranges(prefix: str) -> None:
    assert normalize_nigerian_phone(f"{prefix}012345678") == f"+234{prefix[1]}012345678"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "0800000000",  # too short
        "080000000011",  # too long
        "06000000001",  # not a mobile range
        "+4478000000001",  # not Nigerian
        "0800000000a",
        "+234+8000000001",
    ],
)
def test_rejects_invalid_numbers_without_echoing_input(raw: str) -> None:
    # The message is fixed text, so it can never echo what the user typed.
    with pytest.raises(ValueError) as exc_info:
        normalize_nigerian_phone(raw)

    assert str(exc_info.value) == "Enter a Nigerian mobile number, for example 08000000001"


def test_national_format_groups_like_the_app() -> None:
    # The form the app's screens use (frontend formatPhone).
    assert format_phone_national("+2348133774902") == "0813 377 4902"


@pytest.mark.parametrize("value", ["", "08133774902", "+4478000000001", "+234813377490"])
def test_national_format_leaves_other_values_unchanged(value: str) -> None:
    assert format_phone_national(value) == value


@pytest.mark.parametrize(
    "raw",
    ["08031234567", "+2348031234567", "2348031234567", "+2340803 123 4567", "2340803-123-4567"],
)
def test_every_way_of_typing_a_number_gives_the_same_e164(raw: str) -> None:
    """MTN, Airtel and Glo numbers all reach Termii as 234 + 10 digits (the "0" is never kept)."""
    assert normalize_nigerian_phone(raw) == "+2348031234567"
