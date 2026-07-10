from __future__ import annotations

import hashlib
import secrets
from hmac import compare_digest

PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 210_000


def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(24)
    digest = _derive_password_digest(password, salt, PASSWORD_HASH_ITERATIONS)
    return f"{PASSWORD_HASH_ALGORITHM}${PASSWORD_HASH_ITERATIONS}${salt}${digest}"


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False

    try:
        algorithm, iterations_text, salt, expected_digest = password_hash.split("$", 3)
        iterations = int(iterations_text)
    except ValueError:
        return False

    if algorithm != PASSWORD_HASH_ALGORITHM or iterations <= 0:
        return False

    actual_digest = _derive_password_digest(password, salt, iterations)
    return compare_digest(actual_digest, expected_digest)


def _derive_password_digest(password: str, salt: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
