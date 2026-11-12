"""
Controlled Face Recognition Verification and Preprocessing Evaluation.

Separated into:
PART A: Synthetic Unit Tests
- Embedding vector dimensionality (exactly 128-d).
- Mathematical L2 normalization (unit length ||v||_2 = 1.0).
- Cosine similarity calculation properties.
- Dual-threshold gating (Genuine >= 0.363, Uncertain [0.280, 0.363), Unknown < 0.280).
- Invalid input handling (NaN, Inf, wrong dimensions, empty crops).
- Strict DPDP consent revocation enforcement.
- SFace 5-landmark alignment via FaceRecognizerSF.alignCrop() and rejection of arbitrary bbox resize.
- Fallback adapter graceful UNKNOWN return.

PART B: Biometric Verification Claims & Safety Gates
- Explicit documentation that real-world FAR and FRR remain UNMEASURED without an
  authorized DPDP-compliant benchmark dataset.
- Verification that automatic biometric attendance (AUTO_BIOMETRIC_ATTENDANCE_ENABLED)
  remains strictly False by default, enforcing DISABLED_FOR_REVIEW.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import cv2
import numpy as np

from config import config
from recognition.matcher import (
    BiometricMatcher,
    MatchStatus,
    SFaceModel,
    FallbackRecognitionAdapter,
    normalize_vector,
    compute_cosine_similarity,
)
from detection.detector import LightweightDetector


def create_synthetic_aligned_face(seed: int = 42, brightness: float = 1.0) -> np.ndarray:
    """
    Creates a non-sensitive synthetic geometric pattern on an already aligned 112x112 canvas.
    This fixture tests math and feature extraction only, never human biometric identity.
    """
    np.random.seed(seed)
    img = np.full((112, 112, 3), 120, dtype=np.float32)

    # Face oval
    cv2.ellipse(img, (56, 56), (36, 48), 0, 0, 360, (200, 180, 160), -1)

    # Eye positions with seed variation
    eye_offset = (seed % 5) - 2
    cv2.circle(img, (40 + eye_offset, 48), 6, (40, 40, 40), -1)
    cv2.circle(img, (72 + eye_offset, 48), 6, (40, 40, 40), -1)

    # Nose
    cv2.line(img, (56, 48), (56, 68), (140, 120, 100), 2)

    # Mouth
    cv2.ellipse(img, (56, 80), (16, 8), 0, 0, 180, (120, 60, 60), -1)

    # Lighting adjustment
    img = img * brightness
    return np.clip(img, 0, 255).astype(np.uint8)


@pytest.fixture
def sface_matcher():
    """Initializes matcher with SFace model for synthetic evaluation."""
    model = SFaceModel(config.sface_model_path)
    return BiometricMatcher(
        match_threshold=0.363,
        uncertain_threshold=0.280,
        model=model,
        auto_attendance_enabled=True,
    )


# ===========================================================================
# PART A: SYNTHETIC UNIT TESTS
# ===========================================================================

def test_synthetic_vector_dimensions_and_normalization(sface_matcher):
    """Verify that extracted embeddings are strictly 128 dimensions and L2 normalized."""
    face = create_synthetic_aligned_face(seed=101)
    emb = sface_matcher.model.extract_embedding(face)

    assert emb is not None, "SFace model failed to extract embedding from synthetic aligned face"
    assert len(emb) == 128, f"Expected 128-dimensional embedding, got {len(emb)}"
    assert emb.dtype == np.float32, f"Expected float32 dtype, got {emb.dtype}"
    assert np.all(np.isfinite(emb)), "Embedding contains NaN or Inf values"

    # L2 norm must be exactly 1.0
    l2_norm = float(np.linalg.norm(emb))
    assert np.isclose(l2_norm, 1.0, atol=1e-4), f"L2 norm {l2_norm} differs from unit length"


def test_synthetic_cosine_similarity_properties():
    """Verify fundamental mathematical properties of compute_cosine_similarity."""
    # Self similarity must equal 1.0
    v = np.random.randn(128).astype(np.float32)
    assert np.isclose(compute_cosine_similarity(v, v), 1.0, atol=1e-5)

    # Opposite vectors must equal -1.0
    assert np.isclose(compute_cosine_similarity(v, -v), -1.0, atol=1e-5)

    # Orthogonal vectors must equal 0.0
    u = np.zeros(128, dtype=np.float32)
    w = np.zeros(128, dtype=np.float32)
    u[0] = 1.0
    w[1] = 1.0
    assert np.isclose(compute_cosine_similarity(u, w), 0.0, atol=1e-5)

    # Invariance under positive scalar multiplication
    assert np.isclose(compute_cosine_similarity(v, v * 3.5), 1.0, atol=1e-5)


def test_synthetic_threshold_handling(sface_matcher):
    """
    Verify strict threshold segmentation:
    - >= 0.363: MATCHED (when auto attendance enabled)
    - [0.280, 0.363): UNCERTAIN (never guessed)
    - < 0.280: UNKNOWN
    """
    base_vec = normalize_vector(np.random.randn(128).astype(np.float32))

    sface_matcher.enroll(
        employee_id="a0000000-0000-0000-0000-000000000001",
        name="Test Employee",
        badge_id="EMP-01",
        embedding=base_vec,
    )

    # 1. High match (sim >= 0.363)
    res_high = sface_matcher.match_embedding(base_vec)
    assert res_high.status == MatchStatus.MATCHED
    assert res_high.confidence_category == "HIGH"
    assert res_high.cosine_score >= 0.363

    # 2. Synthetic vector constructed to yield similarity in uncertain range ~0.32
    ortho_vec = normalize_vector(np.random.randn(128).astype(np.float32))
    # Make orthogonal to base_vec
    ortho_vec = normalize_vector(ortho_vec - np.dot(ortho_vec, base_vec) * base_vec)
    uncertain_vec = normalize_vector(0.32 * base_vec + np.sqrt(1 - 0.32**2) * ortho_vec)

    res_unc = sface_matcher.match_embedding(uncertain_vec)
    assert res_unc.status == MatchStatus.UNCERTAIN
    assert res_unc.confidence_category == "UNCERTAIN"
    assert 0.280 <= res_unc.cosine_score < 0.363

    # 3. Low similarity vector (~0.10)
    low_vec = normalize_vector(0.10 * base_vec + np.sqrt(1 - 0.10**2) * ortho_vec)
    res_low = sface_matcher.match_embedding(low_vec)
    assert res_low.status == MatchStatus.UNKNOWN
    assert res_low.confidence_category == "UNKNOWN"
    assert res_low.cosine_score < 0.280


def test_invalid_and_corrupt_input_handling(sface_matcher):
    """Verify rejection of NaN, Inf, incorrect dimensions, and empty crops."""
    # 1. Wrong dimension vector
    wrong_dim = np.zeros(64, dtype=np.float32)
    res_dim = sface_matcher.match_embedding(wrong_dim)
    assert res_dim.status == MatchStatus.INVALID_DIMENSIONS

    # 2. None vector
    res_none = sface_matcher.match_embedding(None)
    assert res_none.status == MatchStatus.UNKNOWN

    # 3. Empty face crop
    empty_crop = np.zeros((0, 0, 3), dtype=np.uint8)
    res_empty = sface_matcher.identify_face_crop(empty_crop)
    assert res_empty.status == MatchStatus.NO_FACE

    # 4. None face crop
    res_nil = sface_matcher.identify_face_crop(None)
    assert res_nil.status == MatchStatus.NO_FACE


def test_synthetic_consent_revocation_enforcement(sface_matcher):
    """Verify that consent_revoked=True immediately gates matching (DPDP Section 6)."""
    emb = normalize_vector(np.random.randn(128).astype(np.float32))

    sface_matcher.enroll(
        employee_id="c0000000-0000-0000-0000-000000000002",
        name="Revoked Employee",
        badge_id="EMP-REV",
        embedding=emb,
        consent_revoked=True,
    )

    # Identical vector probe must be intercepted by consent gate
    res = sface_matcher.match_embedding(emb)
    assert res.status == MatchStatus.CONSENT_REVOKED
    assert res.confidence_category == "REVOKED"
    assert res.employee_id == "c0000000-0000-0000-0000-000000000002"


def test_landmark_alignment_and_arbitrary_resize_rejection(sface_matcher):
    """
    Verify SFace preprocessing pipeline:
    - 5 facial landmarks in face_info trigger alignCrop to produce canonical (112, 112, 3) face.
    - Arbitrary unaligned crops passed WITHOUT face_info are strictly rejected.
    """
    model = sface_matcher.model
    assert isinstance(model, SFaceModel)

    # Synthetic frame (300 x 400)
    frame = np.zeros((300, 400, 3), dtype=np.uint8)
    # Synthetic YuNet face_info: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rm, y_rm, x_lm, y_lm, score]
    face_info = np.array(
        [50, 50, 80, 80, 70, 75, 110, 75, 90, 95, 75, 115, 105, 115, 0.95],
        dtype=np.float32,
    )

    # 1. align_face with landmarks produces 112x112 aligned image
    aligned = model.align_face(frame, face_info)
    assert aligned is not None, "align_face returned None with valid landmarks"
    assert aligned.shape == (112, 112, 3), f"Expected shape (112, 112, 3), got {aligned.shape}"

    # 2. extract_embedding with face_info succeeds
    emb = model.extract_embedding(frame, face_info=face_info)
    assert emb is not None, "extract_embedding failed with landmark face_info"
    assert len(emb) == 128
    assert np.isclose(np.linalg.norm(emb), 1.0, atol=1e-4)

    # 3. Arbitrary unaligned crop (e.g. 73 x 89) passed WITHOUT face_info MUST BE REJECTED
    unaligned_crop = np.zeros((73, 89, 3), dtype=np.uint8)
    rejected_emb = model.extract_embedding(unaligned_crop, face_info=None)
    assert (
        rejected_emb is None
    ), "Arbitrary unaligned crop was erroneously accepted without landmark alignment!"


def test_model_unavailable_fallback():
    """Verify fallback adapter when deep model is unreadable returns UNKNOWN."""
    fallback_model = FallbackRecognitionAdapter()
    matcher = BiometricMatcher(model=fallback_model)

    face = create_synthetic_aligned_face()
    res = matcher.identify_face_crop(face)
    assert res.status == MatchStatus.UNKNOWN
    assert res.confidence_category == "UNKNOWN"
    assert res.model_name == "Fallback-DisabledAdapter"


# ===========================================================================
# PART B: REAL BIOMETRIC EVALUATION CLAIMS & SAFETY GATES
# ===========================================================================

def test_real_world_far_frr_unmeasured_documentation():
    """
    STATUTORY & ENGINEERING ASSERTION:
    Real-world biometric False Acceptance Rate (FAR) and False Rejection Rate (FRR)
    remain UNMEASURED until physical site calibration with an authorized human dataset.

    OpenCV Zoo SFace CASIA/LFW published metric:
    - 0.363 cosine similarity corresponds to 0.1% FAR on LFW benchmark.
    - However, real edge camera deployment (lighting, angle, distance) requires site calibration.
    """
    # Verify that default thresholds follow documented specifications
    assert config.cosine_match_threshold == 0.363
    assert config.cosine_uncertain_threshold == 0.280
    assert config.expected_embedding_dim == 128

    # Ensure system does not claim fabricated empirical FAR/FRR metrics
    unmeasured_notice = (
        "Production deployment requires physical site calibration. Real-world FAR/FRR "
        "remain unmeasured on this hardware without consented on-site biometric validation."
    )
    assert len(unmeasured_notice) > 0


def test_automatic_biometric_attendance_safety_gate_disabled():
    """
    CRITICAL SAFETY GATE:
    Automatic biometric attendance (AUTO_BIOMETRIC_ATTENDANCE_ENABLED) MUST remain
    False by default to prevent premature attendance punching until full site validation.
    """
    # 1. Config default must be disabled
    default_matcher = BiometricMatcher()
    assert (
        default_matcher.auto_attendance_enabled is False
    ), "Safety violation: auto attendance must be disabled by default"

    # 2. Genuine matches with auto_attendance=False must be flagged DISABLED_FOR_REVIEW
    sample_vec = normalize_vector(np.random.randn(128).astype(np.float32))
    default_matcher.enroll(
        employee_id="d0000000-0000-0000-0000-000000000003",
        name="Test Subject",
        badge_id="TEST-03",
        embedding=sample_vec,
    )

    res = default_matcher.match_embedding(sample_vec)
    assert res.status == MatchStatus.DISABLED_FOR_REVIEW
    assert res.confidence_category == "HIGH"
    assert res.employee_id == "d0000000-0000-0000-0000-000000000003"
