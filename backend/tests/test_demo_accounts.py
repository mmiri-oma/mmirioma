import pytest

from app.shared.demo_accounts import is_demo_identity, is_demo_phone


@pytest.mark.parametrize(
    ("phone", "expected"),
    [
        ("+2348000090000", True),
        ("+2348000090099", True),
        ("+234800009001", False),  # one digit short
        ("+23480000900123", False),  # one digit long
        ("+2348000000001", False),
        ("+23480000900ab", False),
    ],
)
def test_reserved_phone_block(phone: str, expected: bool) -> None:
    assert is_demo_phone(phone) is expected


def test_both_markers_are_required() -> None:
    assert is_demo_identity(name="Demo Dispatcher", phone="+2348000090001")
    assert not is_demo_identity(name="Real Person", phone="+2348000090001")
    assert not is_demo_identity(name="Demo Dispatcher", phone="+2348000000001")
    assert not is_demo_identity(name="Demolition Ltd", phone="+2348000090001")
