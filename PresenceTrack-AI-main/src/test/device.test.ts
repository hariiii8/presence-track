import { describe, expect, it } from "vitest";
import { z } from "zod";
import { APP_CONFIG, isNodeLive } from "@/lib/ambient";
import { constantTimeEqual, rejectUnlessDevice } from "@/lib/device-key";

const DeviceSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  stream_url: z.string().trim().url().max(300),
  boundary_name: z.string().trim().max(120).optional(),
  fps: z.number().min(1).max(60).default(15),
  boundary_coordinates: z
    .object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    })
    .default({ x1: 0, y1: 150, x2: 400, y2: 150 }),
});

describe("ESP32 Device Management & Security", () => {
  it("validates camera registration parameters and boundary coordinates", () => {
    const valid = {
      id: "ESP32-CAM-05-WEST",
      stream_url: "http://192.168.1.155:81/stream",
      boundary_name: "Elevator Lobby -> Floor 4 R&D",
      fps: 15,
      boundary_coordinates: { x1: 50, y1: 120, x2: 350, y2: 120 },
    };

    const res = DeviceSchema.safeParse(valid);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.id).toBe("ESP32-CAM-05-WEST");
      expect(res.data.boundary_coordinates.y1).toBe(120);
    }
  });

  it("rejects invalid node IDs containing spaces or special characters", () => {
    expect(
      DeviceSchema.safeParse({
        id: "Invalid Node Name With Spaces",
        stream_url: "http://192.168.1.155:81/stream",
      }).success,
    ).toBe(false);

    expect(
      DeviceSchema.safeParse({
        id: "ESP32#Node$",
        stream_url: "http://192.168.1.155:81/stream",
      }).success,
    ).toBe(false);
  });

  it("dynamically evaluates online and offline state using the heartbeat window", () => {
    const now = 1794050000000;
    const windowMs = APP_CONFIG.nodeOnlineWindowMs; // 60,000ms

    // Ping received 20 seconds ago -> LIVE
    const liveNode = {
      is_online: true,
      last_ping: new Date(now - 20000).toISOString(),
    };
    expect(isNodeLive(liveNode, now)).toBe(true);

    // Ping received 75 seconds ago -> OFFLINE
    const staleNode = {
      is_online: true,
      last_ping: new Date(now - 75000).toISOString(),
    };
    expect(isNodeLive(staleNode, now)).toBe(false);

    // Node marked offline explicitly -> OFFLINE
    const offlineNode = {
      is_online: false,
      last_ping: new Date(now - 5000).toISOString(),
    };
    expect(isNodeLive(offlineNode, now)).toBe(false);
  });

  it("authenticates incoming device requests in constant time and prevents timing leakage", () => {
    const key = "secret_presence_cam_token_9876";

    expect(constantTimeEqual(key, key)).toBe(true);
    expect(constantTimeEqual(key, "wrong_presence_cam_token_9876")).toBe(false);
    expect(constantTimeEqual(key, key.slice(0, 10))).toBe(false);

    const makeReq = (header?: string) =>
      new Request("http://localhost:8080/api/public/esp32/register-node", {
        method: "POST",
        headers: header ? { "x-device-key": header } : {},
      });

    // Valid header -> null (allowed)
    expect(rejectUnlessDevice(makeReq(key), key)).toBeNull();

    // Wrong header -> 401 Unauthorized
    expect(rejectUnlessDevice(makeReq("wrong"), key)?.status).toBe(401);

    // Missing header -> 401 Unauthorized
    expect(rejectUnlessDevice(makeReq(), key)?.status).toBe(401);

    // Server unconfigured -> 503 Service Unavailable
    expect(rejectUnlessDevice(makeReq(key), undefined)?.status).toBe(503);
  });
});
