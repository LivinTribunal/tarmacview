"""symmetric encryption helpers for admin-managed secrets at rest."""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger(__name__)


_FERNET_KEY_LEN_B64 = 44


def _derive_fernet_key(raw: str) -> bytes:
    """accept either a 32-byte url-safe base64 key or any string; sha256-then-b64 the rest."""
    candidate = raw.strip()
    if len(candidate) == _FERNET_KEY_LEN_B64:
        try:
            decoded = base64.urlsafe_b64decode(candidate.encode("ascii"))
            if len(decoded) == 32:
                return candidate.encode("ascii")
        except (ValueError, TypeError):
            pass
    digest = hashlib.sha256(candidate.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    """build a Fernet instance from settings.secret_encryption_key; hard-fail if unset."""
    raw = settings.secret_encryption_key
    if not raw:
        raise RuntimeError(
            "secret_encryption_key is not configured - set SECRET_ENCRYPTION_KEY env var "
            "to encrypt admin-managed secrets at rest"
        )
    return Fernet(_derive_fernet_key(raw))


def encrypt_secret(plaintext: str) -> str:
    """encrypt a string with the configured fernet key; returns a urlsafe-b64 token."""
    if plaintext is None:
        raise ValueError("plaintext is required")
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt_secret(ciphertext: str) -> str | None:
    """decrypt a fernet token; returns None on tamper / unknown ciphertext."""
    if not ciphertext:
        return None
    try:
        return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("failed to decrypt secret - invalid token or wrong key")
        return None
