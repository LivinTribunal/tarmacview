"""tests for app.core.security fernet helpers - key derivation, encrypt/decrypt roundtrip."""

import base64
import hashlib

import pytest
from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.security import _derive_fernet_key, decrypt_secret, encrypt_secret


@pytest.fixture
def passphrase_key(monkeypatch):
    """configure a non-b64 passphrase as the encryption key for the test."""
    monkeypatch.setattr(settings, "secret_encryption_key", "test-passphrase-key-2026")


class TestDeriveFernetKey:
    """tests for _derive_fernet_key - the two derivation branches and their edges."""

    def test_fernet_key_passes_through_unchanged(self):
        """a real 32-byte urlsafe-b64 fernet key is returned verbatim."""
        key = Fernet.generate_key()
        assert _derive_fernet_key(key.decode("ascii")) == key

    def test_fernet_key_with_whitespace_is_stripped(self):
        """surrounding whitespace is stripped before the passthrough check."""
        key = Fernet.generate_key()
        assert _derive_fernet_key(f"  {key.decode('ascii')}\n") == key

    def test_passphrase_hashes_to_valid_fernet_key(self):
        """any non-key string derives sha256-then-b64 and is accepted by Fernet."""
        derived = _derive_fernet_key("not a fernet key")
        expected = base64.urlsafe_b64encode(hashlib.sha256(b"not a fernet key").digest())
        assert derived == expected
        Fernet(derived)

    def test_44_char_non_b64_falls_through_to_hash(self):
        """a 44-char string that is not valid base64 takes the hash branch."""
        candidate = "!" * 44
        derived = _derive_fernet_key(candidate)
        assert derived != candidate.encode("ascii")
        Fernet(derived)

    def test_44_char_b64_wrong_payload_length_falls_through_to_hash(self):
        """44 chars of valid base64 that decode to != 32 bytes take the hash branch."""
        candidate = base64.urlsafe_b64encode(b"x" * 31).decode("ascii")
        assert len(candidate) == 44
        derived = _derive_fernet_key(candidate)
        assert derived != candidate.encode("ascii")
        Fernet(derived)


class TestEncryptDecryptSecret:
    """tests for encrypt_secret / decrypt_secret."""

    def test_roundtrip_with_passphrase_key(self, passphrase_key):
        """encrypt-then-decrypt returns the plaintext under a derived passphrase key."""
        token = encrypt_secret("super-secret-api-key")
        assert token != "super-secret-api-key"
        assert decrypt_secret(token) == "super-secret-api-key"

    def test_roundtrip_with_generated_fernet_key(self, monkeypatch):
        """roundtrip works with a real fernet key on the passthrough branch."""
        monkeypatch.setattr(
            settings, "secret_encryption_key", Fernet.generate_key().decode("ascii")
        )
        token = encrypt_secret("payload")
        assert decrypt_secret(token) == "payload"

    def test_decrypt_tampered_ciphertext_returns_none(self, passphrase_key):
        """flipping one ciphertext character breaks the hmac and yields None."""
        token = encrypt_secret("secret")
        mid = len(token) // 2
        flipped = "A" if token[mid] != "A" else "B"
        assert decrypt_secret(token[:mid] + flipped + token[mid + 1 :]) is None

    def test_decrypt_garbage_ciphertext_returns_none(self, passphrase_key):
        """a string that was never a fernet token decrypts to None, not an exception."""
        assert decrypt_secret("not-a-fernet-token") is None

    def test_decrypt_under_different_key_returns_none(self, monkeypatch):
        """ciphertext from one key decrypts to None under another key."""
        monkeypatch.setattr(settings, "secret_encryption_key", "first-key")
        token = encrypt_secret("secret")
        monkeypatch.setattr(settings, "secret_encryption_key", "second-key")
        assert decrypt_secret(token) is None

    def test_decrypt_empty_returns_none_before_key_lookup(self, monkeypatch):
        """empty/None ciphertext short-circuits to None even with no key configured."""
        monkeypatch.setattr(settings, "secret_encryption_key", None)
        assert decrypt_secret("") is None
        assert decrypt_secret(None) is None

    def test_encrypt_none_raises_value_error(self, passphrase_key):
        """encrypting None is a caller bug and raises ValueError."""
        with pytest.raises(ValueError, match="plaintext is required"):
            encrypt_secret(None)

    def test_encrypt_with_unset_key_raises_runtime_error(self, monkeypatch):
        """encrypting without a configured key hard-fails with RuntimeError."""
        monkeypatch.setattr(settings, "secret_encryption_key", None)
        with pytest.raises(RuntimeError, match="secret_encryption_key is not configured"):
            encrypt_secret("x")

    def test_decrypt_nonempty_with_unset_key_raises_runtime_error(self, monkeypatch):
        """decrypting a non-empty token without a configured key hard-fails too."""
        monkeypatch.setattr(settings, "secret_encryption_key", None)
        with pytest.raises(RuntimeError, match="secret_encryption_key is not configured"):
            decrypt_secret("sometoken")
