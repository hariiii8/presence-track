"""
Centroid and IoU Multi-Object Tracking.

Assigns stable tracking IDs across consecutive frames, maintains trajectory
histories, handles object occlusion / disappearance, and evaluates virtual
boundary crossings.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

from detection.detector import Detection
from tracking.boundary import VirtualBoundary, BoundaryCrossingEvent, CrossingDirection


@dataclass
class Track:
    track_id: int
    bbox: Tuple[int, int, int, int]  # (x, y, w, h)
    centroid: Tuple[int, int]  # (cx, cy)
    trajectory: List[Tuple[int, int]] = field(default_factory=list)
    disappeared: int = 0
    matched_person_id: Optional[str] = None
    matched_name: Optional[str] = None
    matched_cosine: float = 0.0
    consent_revoked: bool = False
    last_crossing: Optional[CrossingDirection] = None
    last_crossing_frame: int = -9999

    def to_dict(self) -> Dict[str, Any]:
        return {
            "track_id": self.track_id,
            "bbox": {"x": self.bbox[0], "y": self.bbox[1], "w": self.bbox[2], "h": self.bbox[3]},
            "centroid": {"x": self.centroid[0], "y": self.centroid[1]},
            "trajectory_length": len(self.trajectory),
            "matched_person_id": self.matched_person_id,
            "matched_name": self.matched_name,
            "matched_cosine": round(self.matched_cosine, 4),
            "last_crossing": self.last_crossing.value if self.last_crossing else None,
        }


def compute_iou(boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]) -> float:
    """Compute Intersection over Union between two bounding boxes (x, y, w, h)."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    inter_w = max(0, xB - xA)
    inter_h = max(0, yB - yA)
    inter_area = inter_w * inter_h

    boxA_area = boxA[2] * boxA[3]
    boxB_area = boxB[2] * boxB[3]
    denom = float(boxA_area + boxB_area - inter_area)
    if denom <= 0:
        return 0.0
    return inter_area / denom


class ObjectTracker:
    def __init__(
        self,
        virtual_boundary: Optional[VirtualBoundary] = None,
        max_disappeared: int = 15,
        max_distance_px: float = 65.0,
        max_trajectory_len: int = 30,
        debounce_frames: int = 30,
    ):
        self.next_track_id: int = 1
        self.tracks: Dict[int, Track] = {}
        self.virtual_boundary = virtual_boundary or VirtualBoundary()
        self.max_disappeared = max_disappeared
        self.max_distance_px = max_distance_px
        self.max_trajectory_len = max_trajectory_len
        self.debounce_frames = debounce_frames
        self.frame_index: int = 0

    def register(self, detection: Detection) -> Track:
        """Register a new object track."""
        track = Track(
            track_id=self.next_track_id,
            bbox=detection.bbox,
            centroid=detection.center,
            trajectory=[detection.center],
        )
        self.tracks[self.next_track_id] = track
        self.next_track_id += 1
        return track

    def deregister(self, track_id: int):
        """Remove an expired track."""
        if track_id in self.tracks:
            del self.tracks[track_id]

    def update(
        self,
        detections: List[Detection],
    ) -> Tuple[List[Track], List[BoundaryCrossingEvent]]:
        """
        Updates tracks with new detections, maintains trajectories, and detects
        virtual boundary crossings.
        """
        self.frame_index += 1
        crossing_events: List[BoundaryCrossingEvent] = []

        # If no detections exist in this frame
        if len(detections) == 0:
            tracks_to_remove = []
            for track_id, track in self.tracks.items():
                track.disappeared += 1
                if track.disappeared > self.max_disappeared:
                    tracks_to_remove.append(track_id)
            for track_id in tracks_to_remove:
                self.deregister(track_id)
            return list(self.tracks.values()), crossing_events

        # If no existing tracks, register all detections
        if len(self.tracks) == 0:
            for det in detections:
                self.register(det)
            return list(self.tracks.values()), crossing_events

        # Match existing tracks with current detections using centroid distance + IoU
        track_ids = list(self.tracks.keys())
        track_centroids = [self.tracks[tid].centroid for tid in track_ids]
        det_centroids = [det.center for det in detections]

        # Compute pairwise distance matrix
        D = np.zeros((len(track_ids), len(detections)), dtype=np.float32)
        for i, tc in enumerate(track_centroids):
            for j, dc in enumerate(det_centroids):
                dist = np.hypot(tc[0] - dc[0], tc[1] - dc[1])
                # IoU bonus to reduce distance when boxes overlap
                iou = compute_iou(self.tracks[track_ids[i]].bbox, detections[j].bbox)
                D[i, j] = dist * (1.0 - 0.4 * iou)

        # Match using greedy minimum distance
        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue

            # If distance exceeds threshold, do not match
            if D[row, col] > self.max_distance_px:
                continue

            track_id = track_ids[row]
            track = self.tracks[track_id]
            det = detections[col]

            # Update track state
            track.bbox = det.bbox
            track.centroid = det.center
            track.disappeared = 0
            track.trajectory.append(det.center)
            if len(track.trajectory) > self.max_trajectory_len:
                track.trajectory.pop(0)

            # Check boundary crossing
            crossing = self.virtual_boundary.check_crossing(
                track_id=track.track_id,
                trajectory=track.trajectory,
                frame_index=self.frame_index,
            )
            if crossing and crossing.direction != CrossingDirection.NONE:
                # Apply debounce to prevent double-triggering
                if (
                    track.last_crossing != crossing.direction
                    or (self.frame_index - track.last_crossing_frame) > self.debounce_frames
                ):
                    track.last_crossing = crossing.direction
                    track.last_crossing_frame = self.frame_index
                    crossing_events.append(crossing)

            used_rows.add(row)
            used_cols.add(col)

        # Handle unmatched existing tracks
        unused_rows = set(range(len(track_ids))) - used_rows
        tracks_to_remove = []
        for r in unused_rows:
            track_id = track_ids[r]
            track = self.tracks[track_id]
            track.disappeared += 1
            if track.disappeared > self.max_disappeared:
                tracks_to_remove.append(track_id)
        for tid in tracks_to_remove:
            self.deregister(tid)

        # Handle unmatched detections (new tracks)
        unused_cols = set(range(len(detections))) - used_cols
        for c in unused_cols:
            self.register(detections[c])

        return list(self.tracks.values()), crossing_events

