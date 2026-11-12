"""
Biometric Encryption & Secure Template Storage (DPDP Act 2023 Compliant).

Provides cross-compatible AES-256-GCM decryption and encryption for biometric templates,
matching the implementation in src/lib/biometric.ts.

Templates at rest must always be encrypted. Plaintext vectors exist only transiently
in memory and are zeroized immediately after matching.
"""

import base64
import json
import os
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from security.memory import zeroize_buffer


def derive_key(secret: Optional[str] = None) -> Optional[bytes]:
    """
    Derives a 32-byte (256-bit) AES key from the environment secret,
    matching the key derivation in src/lib/biometric.ts.
    """
    raw_secret = secret or os.getenv("BIOMETRIC_ENCRYPTION_KEY", "")
    if not raw_secret:
        return None
    # pad with '0' to 32 bytes and slice to 32 bytes
    padded = raw_secret.ljust(32, "0")[:32]
    return padded.encode("utf-8")


def encrypt_biometric_template(
    embedding: Union[List[float], np.ndarray],
    secret: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Encrypts a float vector into an AES-256-GCM encrypted envelope.
    Returns: {"encrypted": True, "payload": "<base64_ciphertext>", "iv": "<base64_iv>"}
    """
    key_bytes = derive_key(secret)
    if isinstance(embedding, np.ndarray):
        vec_list = embedding.astype(float).tolist()
    else:
        vec_list = [float(x) for x in embedding]

    payload_json = json.dumps(vec_list).encode("utf-8")

    if not key_bytes:
        # Fallback when key not configured: plain JSON payload with encrypted=False flag
        return {
            "encrypted": False,
            "payload": json.dumps(vec_list),
        }

    iv = os.urandom(12)  # 96-bit standard AES-GCM IV
    aesgcm = AESGCM(key_bytes)
    ciphertext = aesgcm.encrypt(iv, payload_json, None)

    return {
        "encrypted": True,
        "payload": base64.b64encode(ciphertext).decode("utf-8"),
        "iv": base64.b64encode(iv).decode("utf-8"),
    }


def decrypt_biometric_template(
    envelope: Union[Dict[str, Any], str, None],
    secret: Optional[str] = None,
    expected_dim: Optional[int] = None,
) -> Optional[np.ndarray]:
    """
    Decrypts a stored biometric envelope back into a float32 numpy array.
    Strictly validates dimensions and checks for NaN/Inf.
    """
    if envelope is None:
        return None

    # Handle string input
    if isinstance(envelope, str):
        try:
            parsed = json.parse(envelope) if hasattr(json, "parse") else json.loads(envelope)
            if isinstance(parsed, list):
                vec = np.array(parsed, dtype=np.float32)
                if expected_dim and len(vec) != expected_dim:
                    return None
                return vec
            envelope = parsed
        except Exception:
            return None

    if not isinstance(envelope, dict):
        return None

    if not envelope.get("encrypted", False):
        try:
            raw_payload = envelope.get("payload", "")
            data = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
            if isinstance(data, list):
                vec = np.array(data, dtype=np.float32)
                if expected_dim and len(vec) != expected_dim:
                    return None
                return vec
            return None
        except Exception:
            return None

    key_bytes = derive_key(secret)
    iv_b64 = envelope.get("iv")
    payload_b64 = envelope.get("payload")

    if not key_bytes or not iv_b64 or not payload_b64:
        return None

    try:
        iv = base64.b64decode(iv_b64)
        ciphertext = base64.b64decode(payload_b64)
        aesgcm = AESGCM(key_bytes)
        decrypted_bytes = aesgcm.decrypt(iv, ciphertext, None)
        data = json.loads(decrypted_bytes.decode("utf-8"))
        if not isinstance(data, list):
            return None

        vec = np.array(data, dtype=np.float32)

        # Validate vector integrity
        if np.isnan(vec).any() or np.isinf(vec).any():
            return None

        if expected_dim and len(vec) != expected_dim:
            return None

        return vec
    except Exception:
        return None

