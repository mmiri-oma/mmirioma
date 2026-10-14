from app.modules.auth import security

SECRET = "s" * 40


def test_password_hash_round_trip() -> None:
    encoded = security.hash_password("correct horse battery")

    assert encoded.startswith("scrypt$16$8$2$")
    assert "correct horse battery" not in encoded
    assert security.verify_password("correct horse battery", encoded)
    assert not security.verify_password("wrong password", encoded)


def test_password_hashes_are_salted() -> None:
    assert security.hash_password("same password") != security.hash_password("same password")


def test_verify_rejects_malformed_hashes() -> None:
    assert not security.verify_password("anything", "")
    assert not security.verify_password("anything", "bcrypt$x$y")
    assert not security.verify_password("anything", "scrypt$16$8$2$!!!$???")
    assert not security.verify_password("anything", "scrypt$notanumber$8$2$AAAA$AAAA")


def test_verify_honours_parameters_stored_in_the_hash() -> None:
    # A hash made with different (older) parameters must still verify.
    salt = b"0123456789abcdef"
    derived = security._scrypt("old password", salt, 14, 8, 1, 32)
    encoded = f"scrypt$14$8$1${security._b64encode(salt)}${security._b64encode(derived)}"

    assert security.verify_password("old password", encoded)


def test_session_tokens_are_random_and_long() -> None:
    first, second = security.generate_session_token(), security.generate_session_token()

    assert first != second
    assert len(first) >= 43  # 32 bytes, base64url


def test_session_token_hash_depends_on_secret() -> None:
    token = security.generate_session_token()

    digest = security.hash_session_token(token, SECRET)

    assert len(digest) == 64
    assert digest == security.hash_session_token(token, SECRET)
    assert digest != security.hash_session_token(token, "t" * 40)
    assert token not in digest


def test_csrf_token_is_bound_to_session() -> None:
    token, other = security.generate_session_token(), security.generate_session_token()
    csrf = security.csrf_token_for(token, SECRET)

    assert security.csrf_token_matches(csrf, token, SECRET)
    assert not security.csrf_token_matches(csrf, other, SECRET)
    assert not security.csrf_token_matches(None, token, SECRET)
    assert not security.csrf_token_matches("", token, SECRET)
    assert csrf != security.hash_session_token(token, SECRET)
