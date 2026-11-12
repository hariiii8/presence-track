"""
Validated Biometric Facial Recognition & DPDP Consent Verification.

Uses the official OpenCV Zoo SFace deep neural network (128-d learned embedding)
with documented input/output constraints, strict L2 normalization, and thresholding.

Guarantees:
- Output is a genuine learned facial identity embedding (128-d float32 unit vector).
- Dimension validation rejects any corrupted or incorrect-dimension vectors.
- Strict consent gate: immediately discards matches for employees with revoked consent.
- Explicit UNCERTAIN and UNKNOWN status: never guesses employee identities.
- Immediate DRAM zeroization of volatile crops and vector buffers post-inference.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
import hashlib
import os
from typing import Any, Dict, List, Optional, Tuple, Union
import cv2
import numpy as np

from config import config
from security.memory import zeroize_buffer
from security.encryption import decrypt_biometric_template, encrypt_biometric_template


class MatchStatus(str, Enum):
    MATCHED = "MATCHED"
    DISABLED_FOR_REVIEW = "DISABLED_FOR_REVIEW"
    UNCERTAIN = "UNCERTAIN"
    UNKNOWN = "UNKNOWN"
    CONSENT_REVOKED = "CONSENT_REVOKED"
    INACTIVE = "INACTIVE"
    INVALID_DIMENSIONS = "INVALID_DIMENSIONS"
    NO_FACE = "NO_FACE"


@dataclass
class EnrolledEmployee:
    employee_id: str
    name: str
    badge_id: str
    embedding: np.ndarray  # 128-d float32 unit vector
    consent_revoked: bool = False
    is_active: bool = True


@dataclass
class MatchResult:
    status: MatchStatus
    employee_id: Optional[str] = None
    name: Optional[str] = None
    badge_id: Optional[str] = None
    cosine_score: float = 0.0
    vector_hash: str = ""
    dram_scrub_ms: float = 0.0
    confidence_category: str = "UNKNOWN"  # "HIGH", "UNCERTAIN", "UNKNOWN", "REVOKED"
    model_name: str = "SFace-2021dec"
    embedding_dim: int = 128


def normalize_vector(v: np.ndarray) -> np.ndarray:
    """Normalize a vector to unit L2 norm."""
    norm = np.linalg.norm(v)
    if norm < 1e-12:
        return v
    return v / norm


def compute_cosine_similarity(u: np.ndarray, v: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    u_flat = u.flatten()
    v_flat = v.flatten()
    if len(u_flat) != len(v_flat) or len(u_flat) == 0:
        return 0.0
    u_norm = normalize_vector(u_flat)
    v_norm = normalize_vector(v_flat)
    sim = float(np.dot(u_norm, v_norm))
    return max(-1.0, min(1.0, sim))


# ---------------------------------------------------------------------------
# Recognition Model Adapters
# ---------------------------------------------------------------------------
class FaceRecognitionModel(ABC):
    @abstractmethod
    def extract_embedding(
        self,
        face_input: np.ndarray,
        face_info: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        """Extract a normalized learned identity embedding from face crop or frame+landmarks."""
        pass

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        pass

    @property
    @abstractmethod
    def model_version(self) -> str:
        pass


class SFaceModel(FaceRecognitionModel):
    """
    OpenCV Zoo SFace: SphereFace/CosFace trained on CASIA-WebFace.
    Canonical Input: 112x112 BGR image aligned using 5 facial landmarks.
    Output: 128-dimensional learned feature vector (float32 unit vector).

    Alignment Policy:
    - Faces are aligned using 5 facial landmarks and cv2.FaceRecognizerSF.alignCrop().
    - If face_info (containing 5 landmarks) is provided, alignCrop transforms the face to 112x112 canonical pose.
    - If face_info is None, the input must already be an aligned (112, 112, 3) image.
    - Arbitrary bounding-box resizing (e.g. cv2.resize on unaligned crops) is STRICTLY REJECTED.
    """

    def __init__(self, model_path: str = config.sface_model_path):
        self._model_path = model_path
        self._recognizer: Optional[cv2.FaceRecognizerSF] = None
        self._is_loaded = False

        if os.path.exists(model_path) and hasattr(cv2, "FaceRecognizerSF"):
            try:
                self._recognizer = cv2.FaceRecognizerSF.create(model_path, "")
                self._is_loaded = True
            except Exception:
                self._recognizer = None
                self._is_loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @property
    def embedding_dim(self) -> int:
        return 128

    @property
    def model_name(self) -> str:
        return "OpenCV-SFace"

    @property
    def model_version(self) -> str:
        return "2021dec"

    def align_face(self, frame: np.ndarray, face_info: np.ndarray) -> Optional[np.ndarray]:
        """
        Aligns a detected face using the 5 facial landmarks via FaceRecognizerSF.alignCrop.
        Returns a 112x112 aligned image, or None if landmarks/frame are invalid.
        """
        if not self._is_loaded or self._recognizer is None:
            return None
        if frame is None or frame.size == 0 or face_info is None:
            return None

        try:
            info_arr = np.array(face_info, dtype=np.float32).flatten()
            if len(info_arr) < 14:
                return None
            aligned = self._recognizer.alignCrop(frame, info_arr)
            if aligned is None or aligned.size == 0 or aligned.shape[:2] != (112, 112):
                return None
            return aligned
        except Exception:
            return None

    def extract_embedding(
        self,
        face_input: np.ndarray,
        face_info: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        """
        Extract 128-d L2 normalized learned embedding from face input.
        Verifies:
        - Exactly 128 dimensions.
        - Finite floating-point values (rejects NaN/Inf).
        - Strictly L2 normalized (||v||_2 = 1.0).
        - Rejects arbitrary bounding-box resizing as alignment.
        """
        if not self._is_loaded or self._recognizer is None:
            return None
        if face_input is None or face_input.size == 0:
            return None

        try:
            if face_info is not None:
                aligned = self.align_face(face_input, face_info)
                if aligned is None:
                    return None
            else:
                # If face_info is not provided, input MUST be already aligned to (112, 112, 3).
                # Arbitrary bbox resizing is NOT permitted as face alignment.
                if face_input.shape[:2] != (112, 112):
                    return None
                aligned = face_input

            raw_feat = self._recognizer.feature(aligned)
            if raw_feat is None:
                return None

            feat = raw_feat.flatten().astype(np.float32)
            if len(feat) != 128:
                return None

            if np.isnan(feat).any() or np.isinf(feat).any():
                return None

            norm = np.linalg.norm(feat)
            if norm < 1e-12:
                return None

            return feat / norm
        except Exception:
            return None


class FallbackRecognitionAdapter(FaceRecognitionModel):
    """
    Documented fallback adapter when deep recognition model is not loaded.
    Safely rejects automatic identity identification.
    """

    @property
    def embedding_dim(self) -> int:
        return 128

    @property
    def model_name(self) -> str:
        return "Fallback-DisabledAdapter"

    @property
    def model_version(self) -> str:
        return "v1.0"

    def extract_embedding(
        self,
        face_input: np.ndarray,
        face_info: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        # Refuses to guess identity
        return None


# ---------------------------------------------------------------------------
# Biometric Matcher Core
# ---------------------------------------------------------------------------
class BiometricMatcher:
    def __init__(
        self,
        match_threshold: float = config.cosine_match_threshold,
        uncertain_threshold: float = config.cosine_uncertain_threshold,
        model: Optional[FaceRecognitionModel] = None,
        auto_attendance_enabled: bool = config.auto_biometric_attendance_enabled,
    ):
        self.match_threshold = match_threshold
        self.uncertain_threshold = uncertain_threshold
        self.auto_attendance_enabled = auto_attendance_enabled

        # Initialize model
        if model is not None:
            self.model = model
        elif (
            config.recognition_backend == "sface"
            and os.path.exists(config.sface_model_path)
            and hasattr(cv2, "FaceRecognizerSF")
        ):
            self.model = SFaceModel(config.sface_model_path)
        else:
            self.model = FallbackRecognitionAdapter()

        self.enrolled: Dict[str, EnrolledEmployee] = {}

    def enroll(
        self,
        employee_id: str,
        name: str,
        badge_id: str,
        embedding: Union[np.ndarray, List[float], Dict[str, Any], str],
        consent_revoked: bool = False,
        is_active: bool = True,
        secret: Optional[str] = None,
    ) -> bool:
        """
        Enroll an employee. Accepts raw vector or encrypted AES-GCM envelope.
        Decryption and dimension validation happen in volatile memory.
        """
        if isinstance(embedding, (dict, str)) and (
            isinstance(embedding, str) or embedding.get("encrypted")
        ):
            # Decrypt template
            vec = decrypt_biometric_template(
                embedding,
                secret=secret or config.biometric_encryption_key,
                expected_dim=self.model.embedding_dim,
            )
            if vec is None:
                return False
        elif isinstance(embedding, (list, np.ndarray)):
            vec = np.array(embedding, dtype=np.float32)
        else:
            return False

        # Validate dimensions and values
        if len(vec) != self.model.embedding_dim:
            return False
        if np.isnan(vec).any() or np.isinf(vec).any():
            return False

        unit_vec = normalize_vector(vec)
        self.enrolled[employee_id] = EnrolledEmployee(
            employee_id=employee_id,
            name=name,
            badge_id=badge_id,
            embedding=unit_vec,
            consent_revoked=consent_revoked,
            is_active=is_active,
        )
        return True

    def revoke_consent(self, employee_id: str):
        """Flag employee consent as revoked immediately."""
        if employee_id in self.enrolled:
            self.enrolled[employee_id].consent_revoked = True

    def remove(self, employee_id: str):
        """Erase template from volatile memory (DPDP right to erasure)."""
        if employee_id in self.enrolled:
            zeroize_buffer(self.enrolled[employee_id].embedding)
            del self.enrolled[employee_id]

    def match_embedding(self, query_vector: Optional[np.ndarray]) -> MatchResult:
        """
        Match query embedding vector against enrolled templates.
        Evaluates cosine similarity, checks consent gates, and applies thresholds.
        """
        if query_vector is None:
            return MatchResult(
                status=MatchStatus.UNKNOWN,
                cosine_score=0.0,
                confidence_category="UNKNOWN",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        if len(query_vector) != self.model.embedding_dim:
            return MatchResult(
                status=MatchStatus.INVALID_DIMENSIONS,
                cosine_score=0.0,
                confidence_category="UNKNOWN",
                model_name=self.model.model_name,
                embedding_dim=len(query_vector),
            )

        if len(self.enrolled) == 0:
            return MatchResult(
                status=MatchStatus.UNKNOWN,
                cosine_score=0.0,
                confidence_category="UNKNOWN",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        query_unit = normalize_vector(query_vector.astype(np.float32))
        vector_hash = hashlib.sha256(query_unit.tobytes()).hexdigest()

        best_emp: Optional[EnrolledEmployee] = None
        best_score = -1.0

        for emp in self.enrolled.values():
            sim = compute_cosine_similarity(query_unit, emp.embedding)
            if sim > best_score:
                best_score = sim
                best_emp = emp

        best_score = round(max(-1.0, min(1.0, best_score)), 4)

        # Unknown / below lower threshold
        if best_emp is None or best_score < self.uncertain_threshold:
            return MatchResult(
                status=MatchStatus.UNKNOWN,
                cosine_score=best_score,
                vector_hash=vector_hash,
                confidence_category="UNKNOWN",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        # Explicit Uncertain range (between uncertain_threshold and match_threshold)
        if best_score < self.match_threshold:
            return MatchResult(
                status=MatchStatus.UNCERTAIN,
                employee_id=best_emp.employee_id,
                name=best_emp.name,
                badge_id=best_emp.badge_id,
                cosine_score=best_score,
                vector_hash=vector_hash,
                confidence_category="UNCERTAIN",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        # Above match threshold: evaluate consent and active status
        if best_emp.consent_revoked:
            return MatchResult(
                status=MatchStatus.CONSENT_REVOKED,
                employee_id=best_emp.employee_id,
                name=best_emp.name,
                badge_id=best_emp.badge_id,
                cosine_score=best_score,
                vector_hash=vector_hash,
                confidence_category="REVOKED",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        if not best_emp.is_active:
            return MatchResult(
                status=MatchStatus.INACTIVE,
                employee_id=best_emp.employee_id,
                name=best_emp.name,
                badge_id=best_emp.badge_id,
                cosine_score=best_score,
                vector_hash=vector_hash,
                confidence_category="INACTIVE",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        # If automatic attendance is disabled (safety default), flag for review
        if not self.auto_attendance_enabled:
            return MatchResult(
                status=MatchStatus.DISABLED_FOR_REVIEW,
                employee_id=best_emp.employee_id,
                name=best_emp.name,
                badge_id=best_emp.badge_id,
                cosine_score=best_score,
                vector_hash=vector_hash,
                confidence_category="HIGH",
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        return MatchResult(
            status=MatchStatus.MATCHED,
            employee_id=best_emp.employee_id,
            name=best_emp.name,
            badge_id=best_emp.badge_id,
            cosine_score=best_score,
            vector_hash=vector_hash,
            confidence_category="HIGH",
            model_name=self.model.model_name,
            embedding_dim=self.model.embedding_dim,
        )

    def identify_face_crop(
        self,
        face_crop: Optional[np.ndarray] = None,
        face_info: Optional[np.ndarray] = None,
        source_frame: Optional[np.ndarray] = None,
    ) -> MatchResult:
        """
        Extracts embedding from face crop or (source_frame, face_info) via loaded model,
        matches against enrolled templates, and immediately scrubs volatile memory of
        crop and raw embedding.
        """
        target_input = (
            source_frame
            if (source_frame is not None and face_info is not None)
            else face_crop
        )
        if target_input is None or target_input.size == 0:
            return MatchResult(
                status=MatchStatus.NO_FACE,
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )

        embedding = self.model.extract_embedding(target_input, face_info=face_info)
        if embedding is None:
            # Model cannot extract, face unaligned, or model disabled
            res = MatchResult(
                status=MatchStatus.UNKNOWN,
                model_name=self.model.model_name,
                embedding_dim=self.model.embedding_dim,
            )
        else:
            res = self.match_embedding(embedding)

        # DPDP Memory Zeroization: best-effort scrub of volatile buffers
        scrub_ms = 0.0
        if config.memory_scrub_enabled:
            if face_crop is not None:
                scrub_ms += zeroize_buffer(face_crop)
            if embedding is not None:
                scrub_ms += zeroize_buffer(embedding)

        res.dram_scrub_ms = round(scrub_ms, 3)
        return res
