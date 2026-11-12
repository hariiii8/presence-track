import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Esp32CanvasOverlay } from "@/components/presence/security/Esp32CanvasOverlay";
import { Route as TelemetryRoute } from "@/routes/api/public/esp32/telemetry";
import { Route as BoundaryTransitRoute } from "@/routes/api/public/esp32/boundary-transit";

vi.mock("@/integrations/supabase/client.server", () => ({
  hasSupabaseAdminConfigured: () => true,
  supabaseAdmin: {
    auth: {
      getUser: vi.fn((token: string) => {
        if (token === "valid-security-token" || token === "valid-admin-token") {
          return Promise.resolve({
            data: { user: { id: "sec-user-uuid-1", email: "sec@presencetrack.local" } },
            error: null,
          });
        }
        if (token === "valid-employee-token") {
          return Promise.resolve({
            data: { user: { id: "emp-user-uuid-1", email: "emp@presencetrack.local" } },
            error: null,
          });
        }
        return Promise.resolve({
          data: { user: null },
          error: { message: "Invalid session token" },
        });
      }),
    },
    rpc: vi.fn((fnName: string, args: { _user_id: string; _roles: string[] }) => {
      if (fnName === "has_any_role") {
        const isSecurityOrAdmin = args._user_id === "sec-user-uuid-1";
        return Promise.resolve({ data: isSecurityOrAdmin, error: null });
      }
      return Promise.resolve({ data: false, error: null });
    }),
    from: vi.fn((table: string) => ({
      insert: vi.fn().mockResolvedValue({ data: { id: "test-id" }, error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "a0000000-0000-0000-0000-000000000001",
            consent_revoked: false,
            is_active: true,
          },
          error: null,
        }),
      }),
    })),
  },
}));

type RouteHandler = (args?: { request: Request }) => Promise<Response>;

function getServerHandler(
  route: { options: { server?: { handlers?: Record<string, unknown> } } },
  method: string,
): RouteHandler | undefined {
  return route.options.server?.handlers?.[method] as RouteHandler | undefined;
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("Phase 5: Vision Gateway & Security Telemetry Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ESP32_DEVICE_KEY"] = "test-device-secret-key-32";
  });

  describe("Esp32CanvasOverlay Rendering", () => {
    it("renders standby message when camera is offline", () => {
      render(
        <Esp32CanvasOverlay
          isLive={false}
          faceDetected={false}
          faceBoundingBox={null}
          scScore={0}
          statusMessage="No edge camera nodes online"
        />,
      );
      // Canvas is rendered in container
      expect(screen.queryByText("Identity Verified")).toBeNull();
    });

    it("displays live detection badge and cosine score when face is detected", () => {
      render(
        <Esp32CanvasOverlay
          isLive={true}
          faceDetected={true}
          faceBoundingBox={{ x: 100, y: 80, w: 90, h: 90 }}
          scScore={0.9421}
        />,
      );
      expect(screen.getByText("Identity Verified")).toBeDefined();
      expect(screen.getByText("Sc 0.9421")).toBeDefined();
    });

    it("displays awaiting transit indicator when live but no face is detected", () => {
      render(
        <Esp32CanvasOverlay
          isLive={true}
          faceDetected={false}
          faceBoundingBox={null}
          scScore={0}
        />,
      );
      expect(screen.getByText("Awaiting boundary transit")).toBeDefined();
      expect(screen.queryByText("Identity Verified")).toBeNull();
    });
  });

  describe("Telemetry API Route (/api/public/esp32/telemetry)", () => {
    it("GET rejects unauthorized requests without session credentials (401)", async () => {
      const getHandler = getServerHandler(TelemetryRoute, "GET");
      expect(getHandler).toBeDefined();

      const request = new Request("http://localhost:3000/api/public/esp32/telemetry");
      const response = await getHandler!({ request });
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Session required");
    });

    it("GET strictly rejects requests relying solely on x-device-key (403)", async () => {
      const getHandler = getServerHandler(TelemetryRoute, "GET");
      expect(getHandler).toBeDefined();

      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        headers: { "x-device-key": "test-device-secret-key-32" },
      });
      const response = await getHandler!({ request });
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Device key cannot authorize telemetry retrieval");
    });

    it("GET rejects non-security role (e.g. employee) (403)", async () => {
      const getHandler = getServerHandler(TelemetryRoute, "GET");
      expect(getHandler).toBeDefined();

      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        headers: { authorization: "Bearer valid-employee-token" },
      });
      const response = await getHandler!({ request });
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Security or Super Admin role required");
    });

    it("GET returns current telemetry state when authorized with Security role (200)", async () => {
      const getHandler = getServerHandler(TelemetryRoute, "GET");
      expect(getHandler).toBeDefined();

      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        headers: { authorization: "Bearer valid-security-token" },
      });
      const response = await getHandler!({ request });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.telemetry).toBeDefined();
      expect(json.telemetry.camera_id).toBe("ESP32-CAM-01-NORTH");
    });

    it("POST rejects requests without x-device-key", async () => {
      const postHandler = getServerHandler(TelemetryRoute, "POST");
      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: true,
        }),
      });

      const response = await postHandler!({ request });
      expect(response.status).toBe(401);
    });

    it("POST rejects out-of-bounds bounding box coordinates", async () => {
      const postHandler = getServerHandler(TelemetryRoute, "POST");
      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: true,
          face_bounding_box: { x: 3950, y: 3950, w: 200, h: 200 }, // Extends beyond 4000
        }),
      });

      const response = await postHandler!({ request });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("out-of-bounds");
    });

    it("POST rejects expired or skewed timestamps (replay protection: window is ±30s)", async () => {
      const postHandler = getServerHandler(TelemetryRoute, "POST");
      // Timestamp skewed by 45 seconds (> 30s)
      const oldTimestamp = new Date(Date.now() - 45000).toISOString();
      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: true,
          timestamp: oldTimestamp,
        }),
      });

      const response = await postHandler!({ request });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("replay protection");
    });

    it("POST debounces and suppresses duplicate event_nonces", async () => {
      const postHandler = getServerHandler(TelemetryRoute, "POST");
      const validTimestamp = new Date().toISOString();
      const duplicateNonce = "unique-test-nonce-9999";

      const firstReq = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: false,
          timestamp: validTimestamp,
          event_nonce: duplicateNonce,
        }),
      });
      const firstRes = await postHandler!({ request: firstReq });
      expect(firstRes.status).toBe(200);

      // Replay identical nonce
      const secondReq = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: false,
          timestamp: validTimestamp,
          event_nonce: duplicateNonce,
        }),
      });
      const secondRes = await postHandler!({ request: secondReq });
      expect(secondRes.status).toBe(200);
      const secondJson = await secondRes.json();
      expect(secondJson.debounced).toBe(true);
      expect(secondJson.message).toContain("suppressed");
    });

    it("POST accepts and records telemetry when valid device key is provided", async () => {
      const postHandler = getServerHandler(TelemetryRoute, "POST");
      const validTimestamp = new Date().toISOString();
      const request = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: true,
          face_detected: true,
          face_bounding_box: { x: 120, y: 75, w: 85, h: 85 },
          sc_score: 0.9312,
          matched_name: "Rahul Roy",
          person_count: 1,
          active_tracks: 1,
          last_event: "ZONE_ENTER",
          timestamp: validTimestamp,
          event_nonce: "nonce-123456",
        }),
      });

      const response = await postHandler!({ request });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);

      // Verify authorized Security GET returns the updated telemetry
      const getHandler = getServerHandler(TelemetryRoute, "GET");
      const getReq = new Request("http://localhost:3000/api/public/esp32/telemetry", {
        headers: { authorization: "Bearer valid-security-token" },
      });
      const getRes = await getHandler!({ request: getReq });
      const getJson = await getRes.json();
      expect(getJson.telemetry.face_detected).toBe(true);
      expect(getJson.telemetry.sc_score).toBe(0.9312);
      expect(getJson.telemetry.matched_name).toBe("Rahul Roy");
      expect(getJson.telemetry.face_bounding_box).toEqual({ x: 120, y: 75, w: 85, h: 85 });
    });
  });

  describe("Boundary Transit Gate & Low Confidence Alerting", () => {
    it("POST boundary-transit rejects unauthorized device calls (missing x-device-key)", async () => {
      const postHandler = getServerHandler(BoundaryTransitRoute, "POST");
      const request = new Request("http://localhost:3000/api/public/esp32/boundary-transit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          user_id: "a0000000-0000-0000-0000-000000000001",
          zone_from: "CORRIDOR_TRANSIT",
          zone_to: "WORKSPACE_FLOOR",
          direction: "ZONE_ENTER",
          cosine_score: 0.95,
          dram_scrub_ms: 1.2,
        }),
      });

      const response = await postHandler!({ request });
      expect(response.status).toBe(401);
    });

    it("POST boundary-transit flags score < 0.70 as unknown detection (422 status)", async () => {
      const postHandler = getServerHandler(BoundaryTransitRoute, "POST");
      const request = new Request("http://localhost:3000/api/public/esp32/boundary-transit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": "test-device-secret-key-32",
        },
        body: JSON.stringify({
          camera_id: "ESP32-CAM-01-NORTH",
          user_id: "00000000-0000-0000-0000-000000000000",
          zone_from: "CORRIDOR_TRANSIT",
          zone_to: "WORKSPACE_FLOOR",
          direction: "ZONE_ENTER",
          cosine_score: 0.45,
          dram_scrub_ms: 1.0,
        }),
      });

      const response = await postHandler({ request });
      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.unknown_alert_logged).toBe(true);
      expect(json.error).toContain("0.7000");
    });
  });
});
