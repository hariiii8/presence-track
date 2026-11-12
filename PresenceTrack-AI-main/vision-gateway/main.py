"""
PresenceTrack Edge Vision Gateway.

FastAPI service integrating camera capture, lightweight face/person detection,
multi-object tracking, boundary crossing tripwires, consent-gated biometric
recognition, and authenticated transit event dispatching to the PresenceTrack backend.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import threading
import time
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import numpy as np

from config import config
from camera.stream_reader import CameraStreamReader
from detection.detector import Detection, LightweightDetector
from tracking.boundary import VirtualBoundary, CrossingDirection
from tracking.tracker import ObjectTracker
from recognition.matcher import BiometricMatcher, MatchResult, MatchStatus, SFaceModel, FallbackRecognitionAdapter
from events.dispatcher import EventDispatcher


# Pydantic schemas for API
class HealthResponse(BaseModel):
    status: str
    camera_id: str
    camera_connected: bool
    frames_processed: int
    active_tracks: int
    transits_emitted: int
    unknown_alerts_emitted: int
    uptime_seconds: float
    auto_biometric_attendance_enabled: bool
    recognition_model: str
    embedding_dimension: int


class LiveDetectionResponse(BaseModel):
    camera_id: str
    is_live: bool
    face_detected: bool
    face_bounding_box: Optional[Dict[str, int]] = None
    sc_score: float = 0.0
    confidence_category: str = "UNKNOWN"
    matched_name: Optional[str] = None
    matched_person_id: Optional[str] = None
    consent_revoked: bool = False
    person_count: int = 0
    active_tracks: int = 0
    last_event: Optional[str] = None
    timestamp: str
    auto_attendance_enabled: bool = False


class SimulateCrossingRequest(BaseModel):
    direction: str = Field(..., description="ZONE_ENTER or ZONE_EXIT")
    user_id: Optional[str] = Field(None, description="Enrolled employee UUID")
    cosine_score: float = Field(0.925, ge=0.0, le=1.0)
    zone_from: Optional[str] = None
    zone_to: Optional[str] = None


class EnrollEmployeeRequest(BaseModel):
    employee_id: str
    name: str
    badge_id: str
    embedding: Optional[List[float]] = None
    consent_revoked: bool = False
    is_active: bool = True


# Initialize Gateway Components
camera = CameraStreamReader(
    source=config.camera_source,
    target_fps=config.target_fps,
)
detector = LightweightDetector(
    face_min_confidence=config.face_min_confidence,
    person_min_confidence=config.person_min_confidence,
)
boundary = VirtualBoundary(
    p1=(config.boundary_coords[0], config.boundary_coords[1]),
    p2=(config.boundary_coords[2], config.boundary_coords[3]),
    zone_a=config.zone_a,
    zone_b=config.zone_b,
    frame_width=config.frame_width,
    frame_height=config.frame_height,
)
tracker = ObjectTracker(virtual_boundary=boundary)

# Initialize biometric model
if config.recognition_backend == "sface":
    model = SFaceModel(config.sface_model_path)
else:
    model = FallbackRecognitionAdapter()

matcher = BiometricMatcher(
    match_threshold=config.cosine_match_threshold,
    uncertain_threshold=config.cosine_uncertain_threshold,
    model=model,
    auto_attendance_enabled=config.auto_biometric_attendance_enabled,
)

dispatcher = EventDispatcher(
    backend_url=config.backend_api_url,
    device_key=config.device_key,
    camera_id=config.camera_id,
    debounce_seconds=config.debounce_seconds,
)

# Pipeline State
class GatewayState:
    def __init__(self):
        self.start_time = time.time()
        self.frames_processed = 0
        self.transits_emitted = 0
        self.unknown_alerts_emitted = 0
        self.last_detection: Dict[str, Any] = {
            "camera_id": config.camera_id,
            "is_live": False,
            "face_detected": False,
            "face_bounding_box": None,
            "sc_score": 0.0,
            "confidence_category": "UNKNOWN",
            "matched_name": None,
            "matched_person_id": None,
            "consent_revoked": False,
            "person_count": 0,
            "active_tracks": 0,
            "last_event": None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "auto_attendance_enabled": config.auto_biometric_attendance_enabled,
        }
        self.is_running = False
        self._thread: Optional[threading.Thread] = None


state = GatewayState()


def processing_pipeline_loop():
    """Main CV loop running at target FPS."""
    delay = 1.0 / max(1, config.target_fps)
    last_telemetry_dispatch = 0.0

    while state.is_running:
        t0 = time.time()

        frame = camera.get_latest_frame()
        if frame is not None:
            state.frames_processed += 1
            h, w = frame.shape[:2]
            if w != boundary.frame_width or h != boundary.frame_height:
                boundary.update_resolution(w, h)

            # 1. Detection
            detections_dict = detector.detect_all(frame)
            faces = detections_dict["faces"]
            persons = detections_dict["persons"]

            # Merge detections for tracking (prioritize persons, use faces if no body)
            tracking_detections = persons if len(persons) > 0 else faces

            # 2. Recognition on detected faces
            best_sc_score = 0.0
            best_name = None
            best_person_id = None
            best_category = "UNKNOWN"
            is_revoked = False

            for face in faces:
                if face.face_info is not None:
                    res = matcher.identify_face_crop(
                        face_crop=face.face_crop,
                        face_info=face.face_info,
                        source_frame=frame,
                    )
                elif face.face_crop is not None:
                    res = matcher.identify_face_crop(face_crop=face.face_crop)
                else:
                    continue

                if res.cosine_score > best_sc_score:
                    best_sc_score = res.cosine_score
                    best_name = res.name
                    best_person_id = res.employee_id
                    best_category = res.confidence_category
                    is_revoked = (res.status == MatchStatus.CONSENT_REVOKED)

            # 3. Object Tracking & Boundary Crossing
            active_tracks, crossing_events = tracker.update(tracking_detections)

            # Attach latest biometric identity to tracks
            for t in active_tracks:
                if best_person_id and not t.matched_person_id:
                    t.matched_person_id = best_person_id
                    t.matched_name = best_name
                    t.matched_cosine = best_sc_score
                    t.consent_revoked = is_revoked

            # 4. Handle Crossing Events
            last_event_str = None
            for event in crossing_events:
                last_event_str = event.direction.value
                matched_track = next((tr for tr in active_tracks if tr.track_id == event.track_id), None)
                user_id = matched_track.matched_person_id if matched_track else best_person_id
                score = matched_track.matched_cosine if matched_track else best_sc_score
                revoked = matched_track.consent_revoked if matched_track else is_revoked

                if user_id and not revoked and score >= matcher.match_threshold:
                    if matcher.auto_attendance_enabled:
                        # Verified Employee transit: emit attendance
                        disp_res = dispatcher.dispatch_transit(
                            user_id=user_id,
                            direction=event.direction.value,
                            zone_from=event.zone_from,
                            zone_to=event.zone_to,
                            cosine_score=score,
                            dram_scrub_ms=1.2,
                        )
                        if disp_res.success:
                            state.transits_emitted += 1
                    else:
                        # Auto-attendance safety disabled: log alert for security triage
                        disp_res = dispatcher.dispatch_unknown_crossing(
                            direction=event.direction.value,
                            zone_from=event.zone_from,
                            zone_to=event.zone_to,
                            cosine_score=score,
                        )
                        if disp_res.unknown_logged:
                            state.unknown_alerts_emitted += 1
                elif revoked:
                    # DPDP Consent Revocation gate: discard detection with zero attendance punch
                    pass
                else:
                    # Unknown detection, uncertain, or score below threshold -> alert
                    disp_res = dispatcher.dispatch_unknown_crossing(
                        direction=event.direction.value,
                        zone_from=event.zone_from,
                        zone_to=event.zone_to,
                        cosine_score=score,
                    )
                    if disp_res.unknown_logged:
                        state.unknown_alerts_emitted += 1

            # 5. Update Telemetry State
            face_box = None
            if faces:
                fb = faces[0].bbox
                # Validate bounds
                bx = max(0, min(fb[0], w - 1))
                by = max(0, min(fb[1], h - 1))
                bw = max(1, min(fb[2], w - bx))
                bh = max(1, min(fb[3], h - by))
                face_box = {"x": bx, "y": by, "w": bw, "h": bh}

            now_iso = datetime.now(timezone.utc).isoformat()
            state.last_detection = {
                "camera_id": config.camera_id,
                "is_live": camera.is_connected,
                "face_detected": len(faces) > 0,
                "face_bounding_box": face_box,
                "sc_score": round(best_sc_score, 4),
                "confidence_category": best_category,
                "matched_name": best_name,
                "matched_person_id": best_person_id,
                "consent_revoked": is_revoked,
                "person_count": len(persons),
                "active_tracks": len(active_tracks),
                "last_event": last_event_str,
                "timestamp": now_iso,
                "auto_attendance_enabled": matcher.auto_attendance_enabled,
            }

            # Periodic dispatch to backend telemetry (every 1 second)
            now_sec = time.time()
            if (now_sec - last_telemetry_dispatch) >= 1.0:
                last_telemetry_dispatch = now_sec
                dispatcher.dispatch_telemetry(state.last_detection)

        elapsed = time.time() - t0
        time.sleep(max(0.001, delay - elapsed))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    camera.connect()
    camera.start()
    state.is_running = True
    state._thread = threading.Thread(target=processing_pipeline_loop, daemon=True)
    state._thread.start()
    yield
    # Shutdown
    state.is_running = False
    if state._thread and state._thread.is_alive():
        state._thread.join(timeout=2.0)
    camera.stop()


app = FastAPI(
    title="PresenceTrack Edge Vision Gateway",
    description="Automated Person Detection, Tracking, Virtual Tripwire, and Consent-Gated Attendance Gateway",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS for local React development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["General"])
def index():
    return {
        "service": "PresenceTrack Edge Vision Gateway",
        "camera_id": config.camera_id,
        "version": "1.1.0",
        "docs": "/docs",
        "recognition_model": matcher.model.model_name,
        "auto_biometric_attendance_enabled": matcher.auto_attendance_enabled,
    }


@app.get("/health", response_model=HealthResponse, tags=["Diagnostics"])
def health():
    return HealthResponse(
        status="healthy" if camera.is_connected else "camera_disconnected",
        camera_id=config.camera_id,
        camera_connected=camera.is_connected,
        frames_processed=state.frames_processed,
        active_tracks=len(tracker.tracks),
        transits_emitted=state.transits_emitted,
        unknown_alerts_emitted=state.unknown_alerts_emitted,
        uptime_seconds=round(time.time() - state.start_time, 1),
        auto_biometric_attendance_enabled=matcher.auto_attendance_enabled,
        recognition_model=matcher.model.model_name,
        embedding_dimension=matcher.model.embedding_dim,
    )


@app.get("/camera/status", tags=["Diagnostics"])
def camera_status():
    status = camera.get_status()
    status["camera_id"] = config.camera_id
    status["boundary_coords"] = config.boundary_coords
    status["zones"] = {"zone_a": config.zone_a, "zone_b": config.zone_b}
    return status


@app.get("/api/live-detection", response_model=LiveDetectionResponse, tags=["Telemetry"])
def live_detection():
    """
    Returns latest detection frame coordinates and match results
    for consumption by the React Security Dashboard overlay.
    """
    return LiveDetectionResponse(**state.last_detection)


@app.post("/api/simulate-crossing", tags=["Testing"])
def simulate_crossing(req: SimulateCrossingRequest):
    """
    Simulates a boundary crossing transit event. Useful for testing the
    gateway-to-backend ingestion pipeline without physical video feed.
    """
    zone_from = req.zone_from or (config.zone_a if req.direction == "ZONE_ENTER" else config.zone_b)
    zone_to = req.zone_to or (config.zone_b if req.direction == "ZONE_ENTER" else config.zone_a)

    if req.user_id:
        # Check consent if enrolled in gateway
        emp = matcher.enrolled.get(req.user_id)
        if emp and emp.consent_revoked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Consent has been revoked for this employee",
            )

        res = dispatcher.dispatch_transit(
            user_id=req.user_id,
            direction=req.direction,
            zone_from=zone_from,
            zone_to=zone_to,
            cosine_score=req.cosine_score,
        )
    else:
        # Unknown crossing
        res = dispatcher.dispatch_unknown_crossing(
            direction=req.direction,
            zone_from=zone_from,
            zone_to=zone_to,
            cosine_score=req.cosine_score,
        )

    return {
        "success": res.success,
        "status_code": res.status_code,
        "transit_id": res.transit_id,
        "unknown_logged": res.unknown_logged,
        "debounced": res.debounced,
        "error": res.error,
    }


@app.post("/api/enroll-test-employee", tags=["Testing"])
def enroll_test_employee(req: EnrollEmployeeRequest):
    """Enroll or update test employee biometric embedding (128-d for SFace)."""
    dim = matcher.model.embedding_dim
    if req.embedding and len(req.embedding) == dim:
        emb = np.array(req.embedding, dtype=np.float32)
    else:
        # Generate deterministic normalized unit vector for testing
        np.random.seed(abs(hash(req.employee_id)) % (2**32))
        emb = np.random.randn(dim).astype(np.float32)
        emb /= np.linalg.norm(emb)

    success = matcher.enroll(
        employee_id=req.employee_id,
        name=req.name,
        badge_id=req.badge_id,
        embedding=emb,
        consent_revoked=req.consent_revoked,
        is_active=req.is_active,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to enroll employee template. Expected {dim}-d normalized vector.",
        )
    return {"success": True, "message": f"Employee {req.name} enrolled with {dim}-d template"}


@app.post("/api/revoke-consent/{employee_id}", tags=["Testing"])
def revoke_consent(employee_id: str):
    """Test DPDP consent revocation gate."""
    if employee_id in matcher.enrolled:
        matcher.revoke_consent(employee_id)
        return {"success": True, "message": f"Consent revoked for employee {employee_id}"}
    return {"success": False, "message": "Employee not found"}


if __name__ == "__main__":
    uvicorn.run(app, host=config.host, port=config.port)
