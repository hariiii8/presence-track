"""
Lightweight Person and Face Detection for Edge Vision Gateway.

Optimized for edge and low-latency execution. Detects persons and faces,
extracts bounding boxes, centroid coordinates, and normalized dimensions.
Facial crops are passed to the matcher and volatilely scrubbed immediately after.
"""

import os
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, Any
import cv2
import numpy as np

from config import config
from security.memory import zeroize_buffer


@dataclass
class Detection:
    bbox: Tuple[int, int, int, int]  # (x, y, w, h)
    normalized_bbox: Tuple[float, float, float, float]  # (norm_x, norm_y, norm_w, norm_h) in [0, 1]
    confidence: float
    class_name: str  # "person" | "face"
    center: Tuple[int, int]  # (cx, cy)
    face_crop: Optional[np.ndarray] = None
    face_info: Optional[np.ndarray] = None  # 15-element array [bbox(4), 5 landmarks(10), score(1)]
    landmarks: Optional[np.ndarray] = None  # 10-element array of 5 landmarks (re, le, nt, rm, lm)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "bbox": {"x": self.bbox[0], "y": self.bbox[1], "w": self.bbox[2], "h": self.bbox[3]},
            "normalized_bbox": {
                "x": round(self.normalized_bbox[0], 4),
                "y": round(self.normalized_bbox[1], 4),
                "w": round(self.normalized_bbox[2], 4),
                "h": round(self.normalized_bbox[3], 4),
            },
            "confidence": round(self.confidence, 4),
            "class_name": self.class_name,
            "center": {"x": self.center[0], "y": self.center[1]},
            "has_landmarks": self.landmarks is not None,
        }


class LightweightDetector:
    def __init__(
        self,
        face_min_confidence: float = config.face_min_confidence,
        person_min_confidence: float = config.person_min_confidence,
        yunet_model_path: str = config.yunet_model_path,
    ):
        self.face_min_confidence = face_min_confidence
        self.person_min_confidence = person_min_confidence
        self.yunet_model_path = yunet_model_path

        # 1. Initialize YuNet deep face detector with 5 facial landmarks
        self.yunet_detector = None
        if os.path.exists(yunet_model_path) and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet_detector = cv2.FaceDetectorYN.create(
                    yunet_model_path,
                    "",
                    (config.frame_width, config.frame_height),
                    score_threshold=self.face_min_confidence,
                    nms_threshold=0.3,
                    top_k=50,
                )
            except Exception:
                self.yunet_detector = None

        # 2. Load OpenCV Haar cascades as fallback
        cascade_dir = cv2.data.haarcascades
        face_path = os.path.join(cascade_dir, "haarcascade_frontalface_default.xml")
        upperbody_path = os.path.join(cascade_dir, "haarcascade_upperbody.xml")
        fullbody_path = os.path.join(cascade_dir, "haarcascade_fullbody.xml")

        self.face_cascade = cv2.CascadeClassifier(face_path) if os.path.exists(face_path) else None
        self.body_cascade = cv2.CascadeClassifier(upperbody_path) if os.path.exists(upperbody_path) else None
        if self.body_cascade is None or self.body_cascade.empty():
            self.body_cascade = cv2.CascadeClassifier(fullbody_path) if os.path.exists(fullbody_path) else None

    def detect_faces(self, frame: np.ndarray) -> List[Detection]:
        """
        Detect faces in the given frame.
        Uses YuNet to extract exact 5 facial landmarks for SFace alignment.
        Falls back to Haar cascade if YuNet is unavailable.
        """
        if frame is None or frame.size == 0:
            return []

        h, w = frame.shape[:2]
        detections: List[Detection] = []

        # 1. Primary: YuNet Face Detector with 5 facial landmarks
        if self.yunet_detector is not None:
            try:
                self.yunet_detector.setInputSize((w, h))
                _, faces = self.yunet_detector.detect(frame)
                if faces is not None and len(faces) > 0:
                    for face in faces:
                        fx, fy, fw, fh = face[0:4]
                        conf = float(face[14])
                        if conf < self.face_min_confidence:
                            continue

                        cx = int(fx + fw / 2)
                        cy = int(fy + fh / 2)
                        norm_x = float(fx) / w
                        norm_y = float(fy) / h
                        norm_w = float(fw) / w
                        norm_h = float(fh) / h

                        # Clamp crop bounds
                        x1, y1 = max(0, int(fx)), max(0, int(fy))
                        x2, y2 = min(w, int(fx + fw)), min(h, int(fy + fh))
                        face_crop = frame[y1:y2, x1:x2].copy() if (x2 > x1 and y2 > y1) else None

                        det = Detection(
                            bbox=(int(fx), int(fy), int(fw), int(fh)),
                            normalized_bbox=(norm_x, norm_y, norm_w, norm_h),
                            confidence=conf,
                            class_name="face",
                            center=(cx, cy),
                            face_crop=face_crop,
                            face_info=face.copy(),
                            landmarks=face[4:14].copy(),
                        )
                        detections.append(det)

                    if len(detections) > 0:
                        return detections
            except Exception:
                pass

        # 2. Fallback: Haar cascade face detection (landmarks unavailable)
        if self.face_cascade is not None and not self.face_cascade.empty():
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
            gray = cv2.equalizeHist(gray)

            faces = self.face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(24, 24),
                flags=cv2.CASCADE_SCALE_IMAGE,
            )

            for (x, y, fw, fh) in faces:
                confidence = min(0.99, max(0.55, (fw * fh) / (w * h * 0.15) + 0.6))
                if confidence < self.face_min_confidence:
                    continue

                cx = int(x + fw / 2)
                cy = int(y + fh / 2)
                norm_x = x / w
                norm_y = y / h
                norm_w = fw / w
                norm_h = fh / h

                x1, y1 = max(0, x), max(0, y)
                x2, y2 = min(w, x + fw), min(h, y + fh)
                face_crop = frame[y1:y2, x1:x2].copy() if (x2 > x1 and y2 > y1) else None

                det = Detection(
                    bbox=(int(x), int(y), int(fw), int(fh)),
                    normalized_bbox=(norm_x, norm_y, norm_w, norm_h),
                    confidence=confidence,
                    class_name="face",
                    center=(cx, cy),
                    face_crop=face_crop,
                    face_info=None,
                    landmarks=None,
                )
                detections.append(det)

        return detections

    def detect_persons(self, frame: np.ndarray) -> List[Detection]:
        """Detect persons (bodies or upper bodies) in the frame."""
        if frame is None or frame.size == 0:
            return []

        h, w = frame.shape[:2]
        detections: List[Detection] = []

        if self.body_cascade is not None and not self.body_cascade.empty():
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
            bodies = self.body_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=3,
                minSize=(32, 64),
            )
            for (x, y, bw, bh) in bodies:
                confidence = min(0.95, max(0.50, (bw * bh) / (w * h * 0.25) + 0.5))
                if confidence < self.person_min_confidence:
                    continue
                cx = int(x + bw / 2)
                cy = int(y + bh / 2)
                det = Detection(
                    bbox=(int(x), int(y), int(bw), int(bh)),
                    normalized_bbox=(x / w, y / h, bw / w, bh / h),
                    confidence=confidence,
                    class_name="person",
                    center=(cx, cy),
                )
                detections.append(det)

        # Fallback: if face is detected but body cascade missed, project a person bounding box
        # from face coordinates (face typically occupies upper 15-25% of body)
        faces = self.detect_faces(frame)
        for f in faces:
            # Check if there is already an overlapping person box
            matched_body = False
            for p in detections:
                px, py, pw, ph = p.bbox
                fx, fy, fw, fh = f.bbox
                if px <= f.center[0] <= px + pw and py <= f.center[1] <= py + ph:
                    matched_body = True
                    break

            if not matched_body:
                fx, fy, fw, fh = f.bbox
                # Infer full body bounding box from face position
                inferred_w = int(fw * 2.2)
                inferred_h = int(fh * 4.5)
                inferred_x = max(0, int(fx - (inferred_w - fw) / 2))
                inferred_y = max(0, fy)
                inferred_w = min(w - inferred_x, inferred_w)
                inferred_h = min(h - inferred_y, inferred_h)

                det = Detection(
                    bbox=(inferred_x, inferred_y, inferred_w, inferred_h),
                    normalized_bbox=(inferred_x / w, inferred_y / h, inferred_w / w, inferred_h / h),
                    confidence=f.confidence * 0.9,
                    class_name="person",
                    center=(int(inferred_x + inferred_w / 2), int(inferred_y + inferred_h / 2)),
                )
                detections.append(det)

        return detections

    def detect_all(self, frame: np.ndarray) -> Dict[str, List[Detection]]:
        """Run both face and person detection on the frame."""
        faces = self.detect_faces(frame)
        persons = self.detect_persons(frame)
        return {"faces": faces, "persons": persons}

