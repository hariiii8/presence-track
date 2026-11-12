"""
Virtual Boundary (Tripwire) Crossing Detection.

Detects when a tracked object crosses an optical boundary line.
Computes trajectory vectors from historical centroids, evaluates line intersections,
and determines directional transit (ZONE_ENTER vs ZONE_EXIT).
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple, Dict, Any


class CrossingDirection(str, Enum):
    NONE = "NONE"
    ZONE_ENTER = "ZONE_ENTER"  # Moving from Zone A into Zone B
    ZONE_EXIT = "ZONE_EXIT"    # Moving from Zone B back to Zone A


@dataclass
class BoundaryCrossingEvent:
    track_id: int
    direction: CrossingDirection
    zone_from: str
    zone_to: str
    crossing_point: Tuple[float, float]
    velocity_vector: Tuple[float, float]
    frame_index: int


def ccw(A: Tuple[float, float], B: Tuple[float, float], C: Tuple[float, float]) -> bool:
    """Check if three points are listed in counter-clockwise order."""
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])


def segments_intersect(
    A: Tuple[float, float],
    B: Tuple[float, float],
    C: Tuple[float, float],
    D: Tuple[float, float],
) -> bool:
    """Return True if line segment AB intersects with line segment CD."""
    return (ccw(A, C, D) != ccw(B, C, D)) and (ccw(A, B, C) != ccw(A, B, D))


class VirtualBoundary:
    def __init__(
        self,
        p1: Tuple[float, float] = (0.05, 0.5),  # Normalized (x1, y1)
        p2: Tuple[float, float] = (0.95, 0.5),  # Normalized (x2, y2)
        zone_a: str = "CORRIDOR_TRANSIT",
        zone_b: str = "WORKSPACE_FLOOR",
        frame_width: int = 400,
        frame_height: int = 300,
        tolerance_px: float = 3.0,
    ):
        self.p1_norm = p1
        self.p2_norm = p2
        self.zone_a = zone_a
        self.zone_b = zone_b
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.tolerance_px = tolerance_px

        # Compute pixel coordinates
        self.p1 = (p1[0] * frame_width, p1[1] * frame_height)
        self.p2 = (p2[0] * frame_width, p2[1] * frame_height)

    def update_resolution(self, width: int, height: int):
        """Update frame resolution and recompute pixel boundary line."""
        self.frame_width = width
        self.frame_height = height
        self.p1 = (self.p1_norm[0] * width, self.p1_norm[1] * height)
        self.p2 = (self.p2_norm[0] * width, self.p2_norm[1] * height)

    def signed_distance(self, pt: Tuple[float, float]) -> float:
        """
        Computes the signed 2D cross product distance of a point from the boundary line vector.
        Positive: Zone A side (e.g. above or left of line)
        Negative: Zone B side (e.g. below or right of line)
        """
        x1, y1 = self.p1
        x2, y2 = self.p2
        px, py = pt
        return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

    def check_crossing(
        self,
        track_id: int,
        trajectory: List[Tuple[int, int]],
        frame_index: int = 0,
    ) -> Optional[BoundaryCrossingEvent]:
        """
        Examines the trajectory history of a track to determine if it has crossed
        the virtual boundary line.
        """
        if len(trajectory) < 2:
            return None

        # Look at the most recent movement step
        p_prev = trajectory[-2]
        p_curr = trajectory[-1]

        # Check line segment intersection
        p_prev_f = (float(p_prev[0]), float(p_prev[1]))
        p_curr_f = (float(p_curr[0]), float(p_curr[1]))

        # Calculate signed distances
        d_prev = self.signed_distance(p_prev_f)
        d_curr = self.signed_distance(p_curr_f)

        # To avoid false triggers due to jitter around the line, require a minimum displacement
        # across the boundary
        if abs(d_curr - d_prev) < self.tolerance_px:
            return None

        # Segment intersection with the boundary tripwire
        has_intersected = segments_intersect(p_prev_f, p_curr_f, self.p1, self.p2)

        # Fallback for horizontal tripwires: if points span across y-line within x-bounds
        if not has_intersected and abs(self.p1[1] - self.p2[1]) < 2.0:
            y_line = self.p1[1]
            min_x = min(self.p1[0], self.p2[0]) - 20
            max_x = max(self.p1[0], self.p2[0]) + 20
            if (min_x <= p_curr[0] <= max_x) and (
                (p_prev[1] < y_line <= p_curr[1]) or (p_curr[1] < y_line <= p_prev[1])
            ):
                has_intersected = True

        if not has_intersected:
            return None

        # Compute velocity vector
        vx = float(p_curr[0] - p_prev[0])
        vy = float(p_curr[1] - p_prev[1])

        # Determine direction:
        # If boundary is mostly horizontal (x2 > x1, y1 approx y2):
        # (x2 - x1) > 0.
        # Moving downwards (py increasing): (x2 - x1) * (py - y1) becomes positive.
        # So d_prev <= 0 and d_curr > 0 (or vice versa depending on orientation).
        # We standardise: moving downwards (into room) = ZONE_ENTER (Zone A -> Zone B).
        # Moving upwards (out of room) = ZONE_EXIT (Zone B -> Zone A).
        if abs(self.p2[1] - self.p1[1]) <= abs(self.p2[0] - self.p1[0]):
            # Horizontal boundary
            if vy > 0 or (p_prev[1] <= self.p1[1] and p_curr[1] > self.p1[1]):
                direction = CrossingDirection.ZONE_ENTER
                zone_from = self.zone_a
                zone_to = self.zone_b
            else:
                direction = CrossingDirection.ZONE_EXIT
                zone_from = self.zone_b
                zone_to = self.zone_a
        else:
            # Vertical boundary
            if vx > 0 or (p_prev[0] <= self.p1[0] and p_curr[0] > self.p1[0]):
                direction = CrossingDirection.ZONE_ENTER
                zone_from = self.zone_a
                zone_to = self.zone_b
            else:
                direction = CrossingDirection.ZONE_EXIT
                zone_from = self.zone_b
                zone_to = self.zone_a

        return BoundaryCrossingEvent(
            track_id=track_id,
            direction=direction,
            zone_from=zone_from,
            zone_to=zone_to,
            crossing_point=p_curr_f,
            velocity_vector=(vx, vy),
            frame_index=frame_index,
        )

