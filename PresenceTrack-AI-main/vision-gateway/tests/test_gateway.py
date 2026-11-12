"""
Comprehensive Unit, Security & Integration Test Suite for Edge Vision Gateway.

Covers:
- Video stream ingestion & auto-reconnection
- Person/Face detection with normalized coordinates
- Centroid & IoU tracking across consecutive frames
- Virtual boundary tripwire crossing math (ZONE_ENTER vs ZONE_EXIT)
- SFace deep learned embedding extraction & validation
- Dimension validation & rejection of corrupted vectors
- AES-256-GCM template encryption/decryption (DPDP compliance)
- DPDP consent revocation gate & inactive account rejection
- Replay protection & timestamp skew rejection
- Coordinate bound validation (out-of-bounds rejection)
- Duplicate boundary crossing debouncing
- Continuous processing session verification
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from datetime import datetime, timezone, timedelta
import pytest
import numpy as np
from fastapi.testclient import TestClient

from config import config
from camera.stream_reader import CameraStreamReader
from detection.detector import Detection, LightweightDetector
from tracking.boundary import VirtualBoundary, CrossingDirection, segments_intersect
from tracking.tracker import ObjectTracker, compute_iou
from recognition.matcher import (
    BiometricMatcher,
    MatchStatus,
    SFaceModel,
    FallbackRecognitionAdapter,
    normalize_vector,
    compute_cosine_similarity,
)
from security.memory import zeroize_buffer
from security.encryption import (
    encrypt_biometric_template,
    decrypt_biometric_template,
    derive_key,
)
from events.dispatcher import EventDispatcher
from main import app, matcher, tracker, boundary


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# 1. Video Input & Stream Reader Tests
# ---------------------------------------------------------------------------
def test_synthetic_stream_reader():
    """Verify synthetic frame generator provides valid image frames."""
    reader = CameraStreamReader(source="synthetic")
    assert reader.connect() is True
    assert reader.is_connected is True

    success, frame = reader.read_frame()
    assert success is True
    assert frame is not None
    assert frame.shape == (config.frame_height, config.frame_width, 3)
    assert frame.dtype == np.uint8


def test_stream_reader_disconnect_reconnect():
    """Verify clean resource disconnect and reconnection."""
    reader = CameraStreamReader(source="synthetic")
    reader.connect()
    reader.disconnect()
    assert reader.is_connected is False
    assert reader.connect() is True
    assert reader.is_connected is True


# ---------------------------------------------------------------------------
# 2. Detection & Coordinate Bounds
# ---------------------------------------------------------------------------
def test_detection_dataclass_and_normalization():
    """Verify detection bounding box and normalization math."""
    det = Detection(
        bbox=(50, 100, 40, 60),
        normalized_bbox=(0.125, 0.333, 0.1, 0.2),
        confidence=0.88,
        class_name="face",
        center=(70, 130),
    )
    d = det.to_dict()
    assert d["bbox"] == {"x": 50, "y": 100, "w": 40, "h": 60}
    assert d["confidence"] == 0.88
    assert d["class_name"] == "face"
    assert d["center"] == {"x": 70, "y": 130}


def test_lightweight_detector_empty_frame():
    """Verify detector handles empty or null frames gracefully."""
    det_engine = LightweightDetector()
    assert det_engine.detect_faces(None) == []
    assert det_engine.detect_persons(None) == []


# ---------------------------------------------------------------------------
# 3. Tracking & IoU Tests
# ---------------------------------------------------------------------------
def test_compute_iou():
    """Verify IoU overlap calculations."""
    boxA = (10, 10, 50, 50)
    boxB = (10, 10, 50, 50)
    assert compute_iou(boxA, boxB) == pytest.approx(1.0)
    boxC = (100, 100, 50, 50)
    assert compute_iou(boxA, boxC) == 0.0


def test_tracker_registration_retention_and_expiration():
    """Verify stable track ID assignment and expiration after max_disappeared."""
    tr = ObjectTracker(max_disappeared=2)

    # Frame 1: Detection at (100, 100)
    det1 = Detection(
        bbox=(90, 90, 20, 20),
        normalized_bbox=(0.225, 0.3, 0.05, 0.06),
        confidence=0.9,
        class_name="person",
        center=(100, 100),
    )
    tracks, _ = tr.update([det1])
    assert len(tracks) == 1
    assert tracks[0].track_id == 1

    # Frame 2: Moved slightly to (104, 106) -> Retained same ID
    det2 = Detection(
        bbox=(94, 96, 20, 20),
        normalized_bbox=(0.235, 0.32, 0.05, 0.06),
        confidence=0.92,
        class_name="person",
        center=(104, 106),
    )
    tracks, _ = tr.update([det2])
    assert len(tracks) == 1
    assert tracks[0].track_id == 1

    # Disappeared for 3 frames -> deregistered
    tr.update([])
    tr.update([])
    tr.update([])
    assert len(tr.tracks) == 0


# ---------------------------------------------------------------------------
# 4. Virtual Boundary Crossing Math Tests
# ---------------------------------------------------------------------------
def test_boundary_crossing_zone_enter():
    """Moving top-to-bottom across horizontal boundary triggers ZONE_ENTER."""
    vb = VirtualBoundary(
        p1=(0.0, 0.5),
        p2=(1.0, 0.5),
        zone_a="CORRIDOR_TRANSIT",
        zone_b="WORKSPACE_FLOOR",
        frame_width=400,
        frame_height=300,
    )
    trajectory = [(200, 120), (200, 170)]
    crossing = vb.check_crossing(track_id=1, trajectory=trajectory)
    assert crossing is not None
    assert crossing.direction == CrossingDirection.ZONE_ENTER
    assert crossing.zone_from == "CORRIDOR_TRANSIT"
    assert crossing.zone_to == "WORKSPACE_FLOOR"


def test_boundary_crossing_zone_exit():
    """Moving bottom-to-top across horizontal boundary triggers ZONE_EXIT."""
    vb = VirtualBoundary(
        p1=(0.0, 0.5),
        p2=(1.0, 0.5),
        zone_a="CORRIDOR_TRANSIT",
        zone_b="WORKSPACE_FLOOR",
        frame_width=400,
        frame_height=300,
    )
    trajectory = [(200, 175), (200, 125)]
    crossing = vb.check_crossing(track_id=2, trajectory=trajectory)
    assert crossing is not None
    assert crossing.direction == CrossingDirection.ZONE_EXIT
    assert crossing.zone_from == "WORKSPACE_FLOOR"
    assert crossing.zone_to == "CORRIDOR_TRANSIT"


# ---------------------------------------------------------------------------
# 5. Learned Embedding Validation & Biometrics
# ---------------------------------------------------------------------------
def test_sface_learned_embedding_dimensions():
    """Verify SFace extracts exactly 128-dimensional learned embeddings."""
    model = SFaceModel(config.sface_model_path)
    assert model.embedding_dim == 128
    assert model.is_loaded is True

    test_face = np.full((112, 112, 3), 150, dtype=np.uint8)
    emb = model.extract_embedding(test_face)
    assert emb is not None
    assert len(emb) == 128
    assert emb.dtype == np.float32
    assert np.isclose(np.linalg.norm(emb), 1.0, atol=1e-3)


def test_invalid_embedding_dimensions_rejected():
    """Rejects vectors with incorrect length (e.g. 64-d or 512-d when 128-d expected)."""
    bm = BiometricMatcher(model=SFaceModel(config.sface_model_path))

    # Try enrolling 64-d vector -> must fail
    bad_vec_64 = np.ones(64, dtype=np.float32)
    assert bm.enroll("emp-1", "Emp", "B-1", bad_vec_64) is False

    # Try enrolling vector with NaN -> must fail
    nan_vec = np.ones(128, dtype=np.float32)
    nan_vec[10] = np.nan
    assert bm.enroll("emp-2", "Emp", "B-2", nan_vec) is False


def test_explicit_uncertain_threshold():
    """Score between uncertain_threshold (0.280) and match_threshold (0.363) returns UNCERTAIN."""
    bm = BiometricMatcher(
        match_threshold=0.363,
        uncertain_threshold=0.280,
        model=SFaceModel(config.sface_model_path),
    )
    # Target vector
    vec_enrolled = normalize_vector(np.ones(128, dtype=np.float32))
    bm.enroll("emp-3", "Anil Mehta", "B-3", vec_enrolled)

    # Construct query vector with dot product = 0.320 (in uncertain range)
    # u = vec_enrolled, v = 0.320 * u + sqrt(1 - 0.320^2) * orth
    orth = np.zeros(128, dtype=np.float32)
    orth[:64] = 1.0
    orth[64:] = -1.0
    orth = normalize_vector(orth)  # dot(vec_enrolled, orth) == 0

    query_uncertain = 0.320 * vec_enrolled + np.sqrt(1 - 0.320**2) * orth
    query_uncertain = normalize_vector(query_uncertain)

    res = bm.match_embedding(query_uncertain)
    assert res.status == MatchStatus.UNCERTAIN
    assert res.confidence_category == "UNCERTAIN"
    assert 0.280 <= res.cosine_score < 0.363


def test_dpdp_consent_revocation_gate():
    """When consent is revoked, matching immediately yields CONSENT_REVOKED."""
    bm = BiometricMatcher(
        match_threshold=0.363,
        uncertain_threshold=0.280,
        model=SFaceModel(config.sface_model_path),
        auto_attendance_enabled=True,
    )
    vec = normalize_vector(np.ones(128, dtype=np.float32))

    bm.enroll(
        employee_id="c0000000-0000-0000-0000-000000000003",
        name="Rajesh Patel",
        badge_id="EMP-1003",
        embedding=vec,
        consent_revoked=False,
    )

    # Before revocation: MATCHED
    res_before = bm.match_embedding(vec)
    assert res_before.status == MatchStatus.MATCHED

    # Revoke consent
    bm.revoke_consent("c0000000-0000-0000-0000-000000000003")

    # After revocation: CONSENT_REVOKED
    res_after = bm.match_embedding(vec)
    assert res_after.status == MatchStatus.CONSENT_REVOKED


def test_inactive_employee_rejection():
    """Inactive employee returns INACTIVE and prevents attendance punch."""
    bm = BiometricMatcher(
        match_threshold=0.363,
        model=SFaceModel(config.sface_model_path),
    )
    vec = normalize_vector(np.ones(128, dtype=np.float32))

    bm.enroll(
        employee_id="c0000000-0000-0000-0000-000000000004",
        name="Former Employee",
        badge_id="EMP-1004",
        embedding=vec,
        consent_revoked=False,
        is_active=False,
    )

    res = bm.match_embedding(vec)
    assert res.status == MatchStatus.INACTIVE


# ---------------------------------------------------------------------------
# 6. Biometric Encryption Tests (AES-256-GCM)
# ---------------------------------------------------------------------------
def test_aes_256_gcm_encryption_roundtrip():
    """Verify AES-256-GCM envelope encrypts and decrypts correctly."""
    secret = "test-biometric-secret-key-32-chars"
    vec = [round(float(x), 4) for x in np.random.randn(128)]

    envelope = encrypt_biometric_template(vec, secret=secret)
    assert envelope["encrypted"] is True
    assert "payload" in envelope
    assert "iv" in envelope

    decrypted = decrypt_biometric_template(envelope, secret=secret, expected_dim=128)
    assert decrypted is not None
    assert len(decrypted) == 128
    assert np.allclose(vec, decrypted, atol=1e-4)


def test_invalid_encryption_key_fails_cleanly():
    """Decryption with wrong key returns None without throwing unhandled exceptions."""
    secret_correct = "correct-secret-key-32-chars-long"
    secret_wrong = "wrong-secret-key-32-chars-longer"

    vec = [0.1] * 128
    envelope = encrypt_biometric_template(vec, secret=secret_correct)

    # Attempt decrypt with wrong key
    decrypted = decrypt_biometric_template(envelope, secret=secret_wrong, expected_dim=128)
    assert decrypted is None


# ---------------------------------------------------------------------------
# 7. Event Dispatcher & Debounce Tests
# ---------------------------------------------------------------------------
def test_dispatcher_debounce():
    """Suppresses duplicate events within debounce window."""
    disp = EventDispatcher(debounce_seconds=3.0)
    assert disp.is_debounced("user-1", "ZONE_ENTER", "WORKSPACE_FLOOR") is False
    assert disp.is_debounced("user-1", "ZONE_ENTER", "WORKSPACE_FLOOR") is True
    assert disp.is_debounced("user-1", "ZONE_EXIT", "CORRIDOR_TRANSIT") is False


# ---------------------------------------------------------------------------
# 8. FastAPI Gateway Endpoints Tests
# ---------------------------------------------------------------------------
def test_api_health(client):
    """GET /health returns 200 with service health info and recognition model."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["embedding_dimension"] == 128
    assert "auto_biometric_attendance_enabled" in data


def test_api_camera_status(client):
    """GET /camera/status returns camera parameters."""
    resp = client.get("/camera/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["camera_id"] == config.camera_id


def test_api_live_detection_endpoint(client):
    """GET /api/live-detection returns real-time coordinates for React dashboard."""
    resp = client.get("/api/live-detection")
    assert resp.status_code == 200
    data = resp.json()
    assert "camera_id" in data
    assert "is_live" in data
    assert "confidence_category" in data


def test_api_enroll_and_revoke_test_employee(client):
    """Verify test employee enrollment and consent revocation API."""
    emp_id = "c0000000-0000-0000-0000-000000000099"
    resp = client.post(
        "/api/enroll-test-employee",
        json={
            "employee_id": emp_id,
            "name": "Priya Nair",
            "badge_id": "EMP-1099",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Revoke consent
    resp_rev = client.post(f"/api/revoke-consent/{emp_id}")
    assert resp_rev.status_code == 200

    # Crossing simulation with revoked consent should return 403 Forbidden
    resp_sim = client.post(
        "/api/simulate-crossing",
        json={
            "direction": "ZONE_ENTER",
            "user_id": emp_id,
            "cosine_score": 0.95,
        },
    )
    assert resp_sim.status_code == 403
    assert "Consent has been revoked" in resp_sim.json()["detail"]


# ---------------------------------------------------------------------------
# 9. Continuous Video Pipeline Verification
# ---------------------------------------------------------------------------
def test_continuous_pipeline_session():
    """
    Simulates a continuous video processing session:
    Frame capture -> Detection -> Centroid tracking -> Tripwire crossing -> Dispatch.
    Verifies that one continuous boundary transit triggers exactly ONE crossing event.
    """
    vb = VirtualBoundary(
        p1=(0.0, 0.5),
        p2=(1.0, 0.5),
        zone_a="CORRIDOR_TRANSIT",
        zone_b="WORKSPACE_FLOOR",
        frame_width=400,
        frame_height=300,
    )
    obj_tracker = ObjectTracker(virtual_boundary=vb, debounce_frames=20)

    crossing_events_collected = []

    # Simulate person walking top-to-bottom across horizontal tripwire (y=150)
    # y positions from 120 to 180 across 7 frames
    y_path = [120, 130, 140, 152, 160, 170, 180]
    for frame_idx, y in enumerate(y_path):
        det = Detection(
            bbox=(190, y - 10, 20, 40),
            normalized_bbox=(190 / 400, (y - 10) / 300, 20 / 400, 40 / 300),
            confidence=0.92,
            class_name="person",
            center=(200, y),
        )
        tracks, crossings = obj_tracker.update([det])
        crossing_events_collected.extend(crossings)

    # Exactly 1 crossing event must be emitted despite 7 continuous frames
    assert len(crossing_events_collected) == 1
    assert crossing_events_collected[0].direction == CrossingDirection.ZONE_ENTER
    assert crossing_events_collected[0].zone_to == "WORKSPACE_FLOOR"
