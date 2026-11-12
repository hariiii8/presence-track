"""
DPDP Act 2023 Volatile Memory Management (Application-Level Best-Effort Zeroization).

Provides best-effort in-place zeroization for mutable Python and NumPy buffers (e.g.,
facial crops, temporary query vectors, and plaintext biometric templates) immediately
following feature extraction and matching.

Architectural Scope & Documented Limitations:
- Zeroization is strictly performed on mutable application-managed buffers (e.g. np.ndarray.fill(0),
  bytearray/memoryview in-place overwrites).
- This operation DOES NOT claim or guarantee erasure of internal C++ allocations inside OpenCV,
  ONNX Runtime graph buffers, GPU/VRAM texture memory, or operating system virtual memory paging/swap.
- Raw video frames and cropped facial images are processed strictly in volatile memory and
  are never written to secondary storage (disk/flash).
"""

import time
import numpy as np
from typing import Any, Optional


def zeroize_buffer(buffer: Any) -> float:
    """
    Overwrites mutable application-level buffers with zeros in-place.
    Supports numpy ndarrays, bytearrays, memoryviews, or nested lists thereof.
    
    Returns the actual measured time taken in milliseconds.
    Note: Does not affect unmanaged C++ heap buffers or OS virtual memory pages.
    """
    t0 = time.perf_counter()
    if buffer is None:
        return 0.0

    try:
        if isinstance(buffer, np.ndarray):
            # Overwrite numpy array in-place with zeros
            if buffer.flags.writeable:
                buffer.fill(0)
        elif isinstance(buffer, (bytearray, memoryview)):
            # Overwrite mutable bytes in-place
            for i in range(len(buffer)):
                buffer[i] = 0
        elif isinstance(buffer, list):
            for item in buffer:
                zeroize_buffer(item)
    except Exception:
        pass

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return round(elapsed_ms, 3)


class VolatileBufferContext:
    """
    Context manager to ensure automatic best-effort zeroization of application-level
    buffers upon exiting an inference or matching block.
    """

    def __init__(self, buffer: Any):
        self.buffer = buffer
        self.scrub_ms: float = 0.0

    def __enter__(self):
        return self.buffer

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.scrub_ms = zeroize_buffer(self.buffer)
        return False

