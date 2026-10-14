"""Password hashing and session/CSRF token primitives.

Uses only the standard library (approved instead of adding argon2/bcrypt):

- Passwords: scrypt with OWASP's equivalent-strength parameters
  N=2^16, r=8, p=2 (about 64 MiB per hash). Each hash stores its own
  parameters, so they can be raised later without invalidating old hashes.
- Session tokens: 256 random bits. The database stores only an HMAC-SHA256 of
  the token keyed with ``SESSION_SECRET``, so a database leak alone does not
  yield usable cookies.
- CSRF tokens: HMAC of the session token, so they need no storage and change
  with every session.

Hashing is CPU- and memory-heavy and blocks; call :func:`hash_password` and
:func:`verify_password` through ``asyncio.to_thread`` from async code.
"""

import base64
import hashlib
import hmac
import secrets

SCRYPT_LOG2_N = 16
SCRYPT_R = 8
SCRYPT_P = 2
SCRYPT_SALT_BYTES = 16
SCRYPT_KEY_BYTES = 32
# scrypt needs 128 * N * r bytes (64 MiB here); allow headroom over the default limit.
SCRYPT_MAXMEM = 256 * 1024 * 1024
_SCHEME = "scrypt"

SESSION_TOKEN_BYTES = 32


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _scrypt(password: str, salt: bytes, log2_n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**log2_n,
        r=r,
        p=p,
        maxmem=SCRYPT_MAXMEM,
        dklen=dklen,
    )


def hash_password(password: str) -> str:
    """Hash a password with a fresh random salt.

    Args:
        password: Plain-text password.

    Returns:
        ``scrypt$<log2 N>$<r>$<p>$<salt>$<hash>`` with base64url fields.
    """
    salt = secrets.token_bytes(SCRYPT_SALT_BYTES)
    derived = _scrypt(password, salt, SCRYPT_LOG2_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEY_BYTES)
    params = [str(SCRYPT_LOG2_N), str(SCRYPT_R), str(SCRYPT_P)]
    return "$".join([_SCHEME, *params, _b64encode(salt), _b64encode(derived)])


def verify_password(password: str, encoded: str) -> bool:
    """Check a password against a stored hash in constant time.

    Args:
        password: Plain-text password to check.
        encoded: Value produced by :func:`hash_password`.

    Returns:
        True if the password matches. False for a mismatch or a malformed hash.
    """
    try:
        scheme, log2_n, r, p, salt, expected = encoded.split("$")
        if scheme != _SCHEME:
            return False
        expected_bytes = _b64decode(expected)
        derived = _scrypt(
            password, _b64decode(salt), int(log2_n), int(r), int(p), len(expected_bytes)
        )
    except ValueError:
        return False
    return hmac.compare_digest(derived, expected_bytes)


def generate_session_token() -> str:
    """Return a new random, URL-safe session token for the cookie."""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(token: str, secret: str) -> str:
    """Return the keyed hash of a session token, as stored in the database.

    Args:
        token: Token from the session cookie.
        secret: ``SESSION_SECRET``.

    Returns:
        64-character hex HMAC-SHA256 digest.
    """
    return hmac.new(secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def csrf_token_for(token: str, secret: str) -> str:
    """Derive the CSRF token bound to a session token.

    The "csrf:" prefix keeps this value distinct from the stored session hash,
    so knowing one never reveals the other.

    Args:
        token: Token from the session cookie.
        secret: ``SESSION_SECRET``.

    Returns:
        URL-safe token that the client sends in ``X-CSRF-Token``.
    """
    digest = hmac.new(secret.encode("utf-8"), f"csrf:{token}".encode(), hashlib.sha256).digest()
    return _b64encode(digest)


def csrf_token_matches(provided: str | None, token: str, secret: str) -> bool:
    """Compare a client-sent CSRF token with the expected one in constant time."""
    if not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), csrf_token_for(token, secret).encode())
