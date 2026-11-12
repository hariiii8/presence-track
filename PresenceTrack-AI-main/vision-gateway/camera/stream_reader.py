"""
Video Stream Reader and Camera Ingestion.

Supports MJPEG streams from ESP32-CAM nodes, local video files, and synthetic
test generators. Implements automatic reconnection, thread-safe frame buffering,
and stream health telemetry.
"""

import threading
import time
from typing import Optional, Tuple
import cv2
import numpy as np

from config import config


class CameraStreamReader:
    def __init__(
        self,
        source: str = config.camera_source,
        target_fps: int = config.target_fps,
        reconnect_interval_sec: float = config.reconnect_interval_sec,
        max_reconnect_attempts: int = config.max_reconnect_attempts,
    ):
        self.source = source
        self.target_fps = target_fps
        self.reconnect_interval_sec = reconnect_interval_sec
        self.max_reconnect_attempts = max_reconnect_attempts

        self.cap: Optional[cv2.VideoCapture] = None
        self.is_connected: bool = False
        self.is_running: bool = False
        self.frame_count: int = 0
        self.reconnect_count: int = 0
        self.last_frame_time: float = 0.0
        self.actual_fps: float = 0.0

        self._latest_frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None

        # Synthetic generator state for headless/mock mode
        self.use_synthetic: bool = False
        self._synthetic_step: int = 0

    def connect(self) -> bool:
        """Initialize connection to video source."""
        if self.source in ("synthetic", "test", "mock", "none"):
            self.use_synthetic = True
            self.is_connected = True
            return True

        try:
            # Check if source is integer (device index)
            src = int(self.source) if self.source.isdigit() else self.source
            self.cap = cv2.VideoCapture(src)
            if self.cap.isOpened():
                self.is_connected = True
                self.reconnect_count = 0
                return True
            else:
                self.is_connected = False
                return False
        except Exception:
            self.is_connected = False
            return False

    def disconnect(self):
        """Release video capture resources."""
        self.is_connected = False
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def read_frame(self) -> Tuple[bool, Optional[np.ndarray]]:
        """Reads a single frame from the source or synthetic generator."""
        if self.use_synthetic:
            return True, self._generate_synthetic_frame()

        if not self.is_connected or self.cap is None or not self.cap.isOpened():
            return False, None

        ret, frame = self.cap.read()
        if not ret or frame is None:
            # If video file reached end, loop it
            if isinstance(self.source, str) and not self.source.startswith("http"):
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    return True, frame
            self.is_connected = False
            return False, None

        return True, frame

    def _generate_synthetic_frame(self) -> np.ndarray:
        """Generates a synthetic frame simulating a person moving across the frame."""
        h, w = config.frame_height, config.frame_width
        frame = np.full((h, w, 3), 22, dtype=np.uint8)  # Dark background (matching dark UI)

        # Draw boundary line
        by = int(h * config.boundary_y_ratio)
        cv2.line(frame, (20, by), (w - 20, by), (16, 185, 129), 2)  # Emerald tripwire

        # Simulate person movement across frames
        self._synthetic_step = (self._synthetic_step + 2) % (h - 60)
        cy = 30 + self._synthetic_step
        cx = w // 2

        # Draw person circle and face region
        cv2.circle(frame, (cx, cy), 18, (186, 200, 224), -1)  # Head
        cv2.rectangle(frame, (cx - 24, cy + 18), (cx + 24, cy + 70), (100, 115, 130), -1)  # Body

        return frame

    def start(self):
        """Start background frame reading loop."""
        if self.is_running:
            return

        self.is_running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop background frame reading loop."""
        self.is_running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self.disconnect()

    def _capture_loop(self):
        """Background loop continuously capturing frames and handling reconnections."""
        delay = 1.0 / max(1, self.target_fps)
        while self.is_running:
            t0 = time.time()
            if not self.is_connected:
                # Attempt reconnection
                if self.reconnect_count < self.max_reconnect_attempts:
                    self.reconnect_count += 1
                    time.sleep(self.reconnect_interval_sec)
                    self.connect()
                else:
                    # Switch to synthetic fallback if camera unavailable
                    self.use_synthetic = True
                    self.is_connected = True

            if self.is_connected:
                success, frame = self.read_frame()
                if success and frame is not None:
                    with self._lock:
                        self._latest_frame = frame
                    self.frame_count += 1
                    now = time.time()
                    if self.last_frame_time > 0:
                        dt = now - self.last_frame_time
                        if dt > 0:
                            self.actual_fps = 0.9 * self.actual_fps + 0.1 * (1.0 / dt)
                    self.last_frame_time = now
                else:
                    self.is_connected = False

            elapsed = time.time() - t0
            sleep_time = max(0.001, delay - elapsed)
            time.sleep(sleep_time)

    def get_latest_frame(self) -> Optional[np.ndarray]:
        """Thread-safe retrieval of the most recent frame."""
        with self._lock:
            return self._latest_frame.copy() if self._latest_frame is not None else None

    def get_status(self) -> dict:
        """Returns stream status dictionary."""
        return {
            "source": self.source,
            "is_connected": self.is_connected,
            "is_synthetic": self.use_synthetic,
            "target_fps": self.target_fps,
            "actual_fps": round(self.actual_fps, 1),
            "frame_count": self.frame_count,
            "reconnect_count": self.reconnect_count,
        }

