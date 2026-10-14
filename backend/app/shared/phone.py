"""Nigerian mobile phone number normalization.

Phone numbers identify customers and staff (docs/api/auth.md) and are compared
for uniqueness, so every number is stored in one canonical E.164 form:
``+234`` followed by 10 digits whose first digit is 7, 8 or 9.
"""

import re

# Separators people commonly type; removed before validation.
_SEPARATORS = re.compile(r"[\s\-().]")
# National significant number: 10 digits, starting 7, 8 or 9 (mobile ranges).
_NATIONAL_NUMBER = re.compile(r"[789]\d{9}")


def normalize_nigerian_phone(raw: str) -> str:
    """Convert a Nigerian mobile number to E.164 (``+2348000000001``).

    Accepts the local form (``08000000001``), the international form with or
    without ``+`` (``2348000000001``, ``+2348000000001``), and ignores spaces,
    dashes, dots and brackets.

    Args:
        raw: Number as typed by the user.

    Returns:
        The number as ``+234`` followed by 10 digits.

    Raises:
        ValueError: If the input is not a Nigerian mobile number. The message
            does not echo the input, so it is safe to return to clients.
    """
    digits = _SEPARATORS.sub("", raw)
    if digits.startswith("+234"):
        national = digits[4:]
    elif digits.startswith("234"):
        national = digits[3:]
    elif digits.startswith("0"):
        national = digits[1:]
    else:
        national = digits
    if not _NATIONAL_NUMBER.fullmatch(national):
        raise ValueError("Enter a Nigerian mobile number, for example 08000000001")
    return f"+234{national}"
