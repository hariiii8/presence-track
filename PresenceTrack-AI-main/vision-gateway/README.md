# PresenceTrack Edge Vision Gateway

High-performance, privacy-conscious Edge Computer Vision service for the **PresenceTrack Ambient** automated attendance detection system.

## Key Features

1. **Camera Ingestion**:
   - Supports ESP32-CAM MJPEG HTTP streams, local video files, and synthetic headless generators.
   - Built-in connection watchdog with exponential backoff and automatic reconnection.

2. **Lightweight CV Pipeline**:
   - Haar Cascade / MobileNet face and person detection optimized for 15 FPS edge hardware.
   - Normalized bounding box and centroid calculations.

3. **Multi-Object Tracking & Virtual Boundary Tripwire**:
   - Centroid and IoU object tracking across consecutive frames.
   - Directional vector math evaluating trajectory crossing against a virtual perimeter line (`ZONE_ENTER` vs `ZONE_EXIT`).
   - Frame-level debouncing to eliminate duplicate punch events.

4. **Consent-Gated Biometric Recognition (DPDP Act 2023 Compliant)**:
   - Cosine similarity matching against enrolled 512-dimensional biometric templates.
   - Strict 0.70 confidence threshold: detections below 0.70 are categorized as Unknown and logged to `unknown_detections` for security review.
   - Automatic consent check: if an employee has revoked consent (`consent_revoked = true`), biometrics are immediately discarded with zero attendance recording.
   - Volatile DRAM zeroization: face crops and intermediate embedding vectors are scrubbed from memory immediately post-inference.

5. **Authenticated Telemetry Dispatching**:
   - Sends authenticated transit payloads to `/api/public/esp32/boundary-transit` using `x-device-key` header.
   - Exposes live detection coordinates via `GET /api/live-detection` to power the React Security Console overlay.

## Installation & Setup

```bash
cd vision-gateway

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run gateway service
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## Running Tests

```bash
source .venv/bin/activate
pytest tests/ -v
```

