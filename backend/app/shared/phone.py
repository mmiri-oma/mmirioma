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
    without ``+`` (``2348000000001``, ``+2348000000001``), the international
    form with the local ``0`` kept (``+2340800000001``), and ignores spaces,
    dashes, dots and brackets. Termii needs ``234`` plus ten digits, which is
    this form without the ``+``.

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
    # People often keep the trunk "0" after the country code (+234 0803...).
    if len(national) == 11 and national.startswith("0") and digits.lstrip("+").startswith("234"):
        national = national[1:]
    if not _NATIONAL_NUMBER.fullmatch(national):
        raise ValueError("Enter a Nigerian mobile number, for example 08000000001")
    return f"+234{national}"


def format_phone_for_display(e164: str) -> str:
    """Group a Nigerian E.164 number for messages: ``+234 813 377 4902``.

    Args:
        e164: Number such as ``+2348133774902``.

    Returns:
        The grouped number, or the input unchanged if it is not a Nigerian
        mobile number in E.164 form.
    """
    if not (e164.startswith("+234") and _NATIONAL_NUMBER.fullmatch(e164[4:])):
        return e164
    national = e164[4:]
    return f"+234 {national[:3]} {national[3:6]} {national[6:]}"


def format_phone_national(e164: str) -> str:
    """Write a Nigerian E.164 number as people dial it locally: ``0813 377 4902``.

    The form the app's screens use (``formatPhone`` in
    ``frontend/src/lib/format/phone.ts``), for text shown in the app, such as
    in-app messages. SMS texts keep :func:`format_phone_for_display`.

    Args:
        e164: Number such as ``+2348133774902``.

    Returns:
        The grouped local number, or the input unchanged if it is not a
        Nigerian mobile number in E.164 form.
    """
    if not (e164.startswith("+234") and _NATIONAL_NUMBER.fullmatch(e164[4:])):
        return e164
    national = e164[4:]
    return f"0{national[:3]} {national[3:6]} {national[6:]}"
