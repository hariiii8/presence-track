"""
Configuration module for the Edge Vision Gateway.
Loads settings from environment variables with safe defaults.
"""

import os
from dataclasses import dataclass, field
from typing import Tuple


@dataclass
class GatewayConfig:
    # Camera settings
    camera_source: str = os.getenv("CAMERA_SOURCE", "synthetic")  # URL, file path, or "synthetic"
    camera_id: str = os.getenv("CAMERA_ID", "ESP32-CAM-01-NORTH")
    target_fps: int = int(os.getenv("CAMERA_FPS", "15"))
    frame_width: int = int(os.getenv("FRAME_WIDTH", "400"))
    frame_height: int = int(os.getenv("FRAME_HEIGHT", "300"))
    reconnect_interval_sec: float = float(os.getenv("RECONNECT_INTERVAL_SEC", "2.0"))
    max_reconnect_attempts: int = int(os.getenv("MAX_RECONNECT_ATTEMPTS", "10"))

    # Backend API settings
    backend_api_url: str = os.getenv("BACKEND_API_URL", "http://localhost:3000").rstrip("/")
    device_key: str = os.getenv("ESP32_DEVICE_KEY", "dev-presence-device-key-32")
    request_timeout_sec: float = float(os.getenv("REQUEST_TIMEOUT_SEC", "5.0"))

    # Virtual Boundary Tripwire settings
    zone_a: str = os.getenv("ZONE_A", "CORRIDOR_TRANSIT")
    zone_b: str = os.getenv("ZONE_B", "WORKSPACE_FLOOR")
    boundary_y_ratio: float = float(os.getenv("BOUNDARY_Y_RATIO", "0.5"))  # Mid-frame horizontal tripwire
    # (x1, y1, x2, y2) normalized coordinates [0.0 - 1.0]
    boundary_coords: Tuple[float, float, float, float] = (0.05, 0.5, 0.95, 0.5)

    # Recognition & Detection Model Settings
    # Backend options: "sface" (OpenCV SFace 128-d deep model) or "adapter"
    recognition_backend: str = os.getenv("RECOGNITION_BACKEND", "sface")
    sface_model_path: str = os.getenv(
        "SFACE_MODEL_PATH", "vision-gateway/models/face_recognition_sface_2021dec.onnx"
    )
    yunet_model_path: str = os.getenv(
        "YUNET_MODEL_PATH", "vision-gateway/models/face_detection_yunet_2023mar.onnx"
    )
    expected_embedding_dim: int = int(os.getenv("EXPECTED_EMBEDDING_DIM", "128"))

    # Thresholds: Evaluated based on official OpenCV Zoo benchmarks
    # For SFace Cosine similarity:
    #   score >= 0.363 -> Genuine match (FAR = 0.1% on LFW benchmark)
    #   0.280 <= score < 0.363 -> Uncertain (explicitly flagged, never guessed)
    #   score < 0.280 -> Definitively unknown
    cosine_match_threshold: float = float(os.getenv("COSINE_MATCH_THRESHOLD", "0.363"))
    cosine_uncertain_threshold: float = float(os.getenv("COSINE_UNCERTAIN_THRESHOLD", "0.280"))

    # Automatic Biometric Attendance Safety Gate
    # Disabled by default until controlled on-site camera calibration & validation is performed
    auto_biometric_attendance_enabled: bool = (
        os.getenv("AUTO_BIOMETRIC_ATTENDANCE_ENABLED", "false").lower() in ("true", "1", "yes")
    )

    # Detection & Debounce
    face_min_confidence: float = float(os.getenv("FACE_MIN_CONFIDENCE", "0.50"))
    person_min_confidence: float = float(os.getenv("PERSON_MIN_CONFIDENCE", "0.45"))
    debounce_seconds: float = float(os.getenv("DEBOUNCE_SECONDS", "3.0"))

    # DPDP Act 2023 Compliance & Security
    memory_scrub_enabled: bool = (
        os.getenv("MEMORY_SCRUB_ENABLED", "true").lower() in ("true", "1", "yes")
    )
    biometric_encryption_key: str = os.getenv("BIOMETRIC_ENCRYPTION_KEY", "dev-presence-biometric-key-32")

    # Gateway Server
    host: str = os.getenv("GATEWAY_HOST", "0.0.0.0")
    port: int = int(os.getenv("GATEWAY_PORT", "8001"))


# Global default configuration instance
config = GatewayConfig()
