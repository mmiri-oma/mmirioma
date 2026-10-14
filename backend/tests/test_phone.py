import pytest

from app.shared.phone import normalize_nigerian_phone


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
