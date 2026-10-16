"""Which accounts are demo data (BR-09, NFR-031).

Demo accounts are created by the seed command (``app.modules.demo.seed``).
Accounts have no ``is_simulated`` column, so a demo account is recognised by
two markers that must **both** hold: a phone in the reserved block
``+23480000900NN`` and a name starting with "Demo ". A real person who
registers a reserved number still fails the name check.

Shared by the demo seed and the orders module, which marks orders created by
demo accounts as simulated.
"""

# Every phone in the reserved block starts with this prefix and ends with two
# more digits (+23480000900NN).
DEMO_PHONE_PREFIX = "+23480000900"
DEMO_NAME_PREFIX = "Demo "


def is_demo_phone(phone: str) -> bool:
    """Whether a normalized (E.164) phone is in the reserved demo block.

    Args:
        phone: Phone in ``+234...`` form.

    Returns:
        True for ``+23480000900`` followed by exactly two digits.
    """
    suffix = phone.removeprefix(DEMO_PHONE_PREFIX)
    return suffix != phone and len(suffix) == 2 and suffix.isdigit()


def is_demo_identity(*, name: str, phone: str) -> bool:
    """Whether an account's name and phone mark it as demo data.

    Args:
        name: The account's name.
        phone: The account's normalized phone.

    Returns:
        True when the phone is reserved **and** the name starts with "Demo ".
    """
    return is_demo_phone(phone) and name.startswith(DEMO_NAME_PREFIX)
