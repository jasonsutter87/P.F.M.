"""
PFM Security - Cryptographic signing, verification, and encryption.

Security features:
  - HMAC-SHA256 signing (shared secret)
  - Content integrity verification via checksum
  - AES-256-GCM encryption for sensitive .pfm files
  - Tamper detection (signature covers meta + all sections)
  - Key derivation via PBKDF2 for password-based encryption
"""

from __future__ import annotations

import hashlib
import hmac
import os
import base64
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pfm.document import PFMDocument


# =============================================================================
# HMAC Signing & Verification
# =============================================================================

def sign(doc: PFMDocument, secret: str | bytes) -> str:
    """
    Sign a PFM document with HMAC-SHA256.
    Returns the hex signature string.
    Sets doc.custom_meta["signature"] and doc.custom_meta["sig_algo"].
    """
    if isinstance(secret, str):
        secret = secret.encode("utf-8")

    # Build the message to sign: meta fields + all section contents
    message = _build_signing_message(doc)
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()

    doc.custom_meta["signature"] = signature
    doc.custom_meta["sig_algo"] = "hmac-sha256"

    return signature


def verify(doc: PFMDocument, secret: str | bytes) -> bool:
    """
    Verify the HMAC-SHA256 signature of a PFM document.
    Returns True if valid, False if tampered or unsigned.
    """
    stored_sig = doc.custom_meta.get("signature", "")
    if not stored_sig:
        return False

    if isinstance(secret, str):
        secret = secret.encode("utf-8")

    # Temporarily remove signature fields to compute expected sig
    saved_sig = doc.custom_meta.pop("signature", "")
    saved_algo = doc.custom_meta.pop("sig_algo", "")

    message = _build_signing_message(doc)
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()

    # Restore
    doc.custom_meta["signature"] = saved_sig
    doc.custom_meta["sig_algo"] = saved_algo

    return hmac.compare_digest(stored_sig, expected)


def _build_signing_message(doc: PFMDocument) -> bytes:
    """Build the canonical message bytes for signing."""
    parts = []

    # Include key meta fields in deterministic order
    for key in sorted(doc.get_meta_dict().keys()):
        val = doc.get_meta_dict()[key]
        parts.append(f"{key}={val}".encode("utf-8"))

    # Include all section names and contents
    for section in doc.sections:
        parts.append(f"[{section.name}]".encode("utf-8"))
        parts.append(section.content.encode("utf-8"))

    return b"\x00".join(parts)


# =============================================================================
# AES-256-GCM Encryption
# =============================================================================

def _derive_key(password: str, salt: bytes) -> bytes:
    """Derive a 256-bit key from a password using PBKDF2."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations=600_000,  # OWASP recommended minimum
        dklen=32,
    )


def encrypt_bytes(data: bytes, password: str) -> bytes:
    """
    Encrypt raw bytes with AES-256-GCM using a password.
    Returns: salt (16) + nonce (12) + ciphertext + tag (16)

    Uses the `cryptography` library if available, falls back to
    a pure-Python XChaCha20-like construction warning if not.
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise ImportError(
            "The 'cryptography' package is required for encryption. "
            "Install it with: pip install cryptography"
        )

    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(password, salt)

    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data, None)

    return salt + nonce + ciphertext


def decrypt_bytes(encrypted: bytes, password: str) -> bytes:
    """
    Decrypt bytes that were encrypted with encrypt_bytes().
    Expects: salt (16) + nonce (12) + ciphertext + tag (16)
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise ImportError(
            "The 'cryptography' package is required for decryption. "
            "Install it with: pip install cryptography"
        )

    salt = encrypted[:16]
    nonce = encrypted[16:28]
    ciphertext = encrypted[28:]

    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)

    return aesgcm.decrypt(nonce, ciphertext, None)


def encrypt_document(doc: PFMDocument, password: str) -> bytes:
    """
    Encrypt an entire PFM document.
    Returns encrypted bytes that can be written to a .pfm.enc file.

    The encrypted payload is prefixed with a plaintext magic header
    so tools can identify it as an encrypted PFM file.
    """
    from pfm.writer import PFMWriter

    plaintext = PFMWriter.serialize(doc)
    encrypted = encrypt_bytes(plaintext, password)

    # Prefix with identifiable header
    header = b"#!PFM-ENC/1.0\n"
    return header + encrypted


def decrypt_document(data: bytes, password: str) -> "PFMDocument":
    """
    Decrypt an encrypted PFM document.
    Expects data from encrypt_document().
    """
    from pfm.reader import PFMReader

    # Strip the header
    header_end = data.index(b"\n") + 1
    encrypted = data[header_end:]

    plaintext = decrypt_bytes(encrypted, password)
    return PFMReader.parse(plaintext)


def is_encrypted_pfm(data: bytes) -> bool:
    """Check if data is an encrypted PFM file."""
    return data.startswith(b"#!PFM-ENC/")


# =============================================================================
# Content Integrity
# =============================================================================

def verify_integrity(doc: PFMDocument) -> bool:
    """
    Verify document integrity by recomputing and comparing checksum.
    Returns True if checksum matches (content hasn't been modified).
    """
    if not doc.checksum:
        return True  # No checksum stored
    return doc.checksum == doc.compute_checksum()


def fingerprint(doc: PFMDocument) -> str:
    """
    Generate a unique fingerprint for a document.
    Based on id + checksum + creation time.
    Useful for deduplication and tracking.
    """
    material = f"{doc.id}:{doc.checksum}:{doc.created}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
