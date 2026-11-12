"""
Event Dispatcher for Edge Vision Gateway.

Dispatches authenticated boundary transit telemetry to the backend API
using the shared x-device-key secret. Handles unknown detection logging,
debouncing, and retry backoff.
"""

import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional, Tuple, Any
import requests

from config import config
from recognition.matcher import MatchResult, MatchStatus


@dataclass
class DispatchResult:
    success: bool
    status_code: int
    transit_id: Optional[str] = None
    unknown_logged: bool = False
    debounced: bool = False
    error: Optional[str] = None


class EventDispatcher:
    def __init__(
        self,
        backend_url: str = config.backend_api_url,
        device_key: str = config.device_key,
        camera_id: str = config.camera_id,
        debounce_seconds: float = config.debounce_seconds,
        timeout_sec: float = config.request_timeout_sec,
    ):
        self.backend_url = backend_url.rstrip("/")
        self.device_key = device_key
        self.camera_id = camera_id
        self.debounce_seconds = debounce_seconds
        self.timeout_sec = timeout_sec

        # Local debounce cache: (identifier, direction, zone_to) -> timestamp
        self._debounce_cache: Dict[Tuple[str, str, str], float] = {}

    def is_debounced(self, identifier: str, direction: str, zone_to: str) -> bool:
        """Check if an identical event was emitted within debounce window."""
        key = (identifier, direction, zone_to)
        now = time.time()
        last_time = self._debounce_cache.get(key, 0.0)
        if (now - last_time) < self.debounce_seconds:
            return True
        self._debounce_cache[key] = now
        return False

    def dispatch_transit(
        self,
        user_id: str,
        direction: str,
        zone_from: str,
        zone_to: str,
        cosine_score: float,
        dram_scrub_ms: float = 1.0,
        vector_hash: Optional[str] = None,
        max_retries: int = 3,
    ) -> DispatchResult:
        """
        Send an authenticated transit event to /api/public/esp32/boundary-transit.
        """
        if self.is_debounced(user_id, direction, zone_to):
            return DispatchResult(
                success=True,
                status_code=200,
                debounced=True,
                error="Duplicate event debounced locally",
            )

        url = f"{self.backend_url}/api/public/esp32/boundary-transit"
        headers = {
            "x-device-key": self.device_key,
            "Content-Type": "application/json",
        }
        payload = {
            "camera_id": self.camera_id,
            "user_id": user_id,
            "zone_from": zone_from,
            "zone_to": zone_to,
            "direction": direction,
            "cosine_score": round(cosine_score, 4),
            "dram_scrub_ms": round(dram_scrub_ms, 2),
            "vector_hash": vector_hash or uuid.uuid4().hex,
        }

        backoff = 0.3
        for attempt in range(max_retries):
            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout_sec)

                # 200 OK -> Recorded or debounced on server
                if resp.status_code == 200:
                    data = resp.json()
                    return DispatchResult(
                        success=True,
                        status_code=200,
                        transit_id=data.get("transit_id"),
                        debounced=data.get("debounced", False),
                    )

                # 422 Unprocessable -> Unknown / low confidence (< 0.70), logged as alert
                if resp.status_code == 422:
                    data = resp.json()
                    return DispatchResult(
                        success=False,
                        status_code=422,
                        unknown_logged=data.get("unknown_alert_logged", False),
                        error=data.get("error", "Low confidence match"),
                    )

                # 403 Forbidden -> Consent revoked or invalid key
                if resp.status_code in (401, 403):
                    return DispatchResult(
                        success=False,
                        status_code=resp.status_code,
                        error=resp.text,
                    )

                # 5xx Server Error -> Retry
                if resp.status_code >= 500 and attempt < max_retries - 1:
                    time.sleep(backoff)
                    backoff *= 2
                    continue

                return DispatchResult(
                    success=False,
                    status_code=resp.status_code,
                    error=resp.text,
                )

            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                return DispatchResult(
                    success=False,
                    status_code=0,
                    error=f"Network connection failed: {str(e)}",
                )

        return DispatchResult(success=False, status_code=0, error="Max retries exceeded")

    def dispatch_unknown_crossing(
        self,
        direction: str,
        zone_from: str,
        zone_to: str,
        cosine_score: float = 0.45,
        vector_hash: Optional[str] = None,
    ) -> DispatchResult:
        """
        Dispatches an unknown person crossing the boundary.
        Uses a dummy UUID and confidence < 0.70 to trigger unknown_detections insertion.
        """
        # Nil UUID for unknown person
        unknown_id = "00000000-0000-0000-0000-000000000000"
        return self.dispatch_transit(
            user_id=unknown_id,
            direction=direction,
            zone_from=zone_from,
            zone_to=zone_to,
            cosine_score=min(0.69, cosine_score),
            dram_scrub_ms=1.0,
            vector_hash=vector_hash or uuid.uuid4().hex,
        )

    def dispatch_telemetry(self, telemetry_data: Dict[str, Any]) -> bool:
        """
        Publish live detection coordinates to backend telemetry endpoint with nonce and timestamp.
        """
        url = f"{self.backend_url}/api/public/esp32/telemetry"
        headers = {
            "x-device-key": self.device_key,
            "Content-Type": "application/json",
        }
        payload = dict(telemetry_data)
        if "timestamp" not in payload:
            from datetime import datetime, timezone
            payload["timestamp"] = datetime.now(timezone.utc).isoformat()
        if "event_nonce" not in payload:
            payload["event_nonce"] = uuid.uuid4().hex

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=2.0)
            return resp.status_code == 200
        except Exception:
            return False

