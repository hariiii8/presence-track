import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rejectUnlessDevice } from "@/lib/device-key";

const zone = z.enum(["WORKSPACE_FLOOR", "CAFETERIA_LOUNGE", "OUTDOOR_TERRACE", "CORRIDOR_TRANSIT"]);

const RegisterSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  stream_url: z.string().trim().url().max(300),
  boundary_name: z.string().trim().max(120).optional(),
  zone_a: zone.optional(),
  zone_b: zone.optional(),
  is_online: z.boolean().optional(),
  fps: z.number().min(0).max(120).optional(),
  boundary_coordinates: z
    .object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    })
    .optional(),
  firmware_version: z.string().trim().max(32).optional(),
});

/** Called by ESP32-CAM firmware on boot and every heartbeat (15s). Requires the x-device-key header. */
export const Route = createFileRoute("/api/public/esp32/register-node")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = rejectUnlessDevice(request, process.env["ESP32_DEVICE_KEY"]);
        if (denied) return denied;

        const { hasSupabaseAdminConfigured } =
          await import("@/integrations/supabase/client.server");
        if (!hasSupabaseAdminConfigured()) {
          return Response.json(
            { success: false, error: "Database admin service key is not configured" },
            { status: 503 },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ success: false, error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = RegisterSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { success: false, error: "Missing or invalid fields: id, stream_url" },
            { status: 400 },
          );
        }
        const n = parsed.data;
        const node = {
          id: n.id,
          stream_url: n.stream_url,
          boundary_name: n.boundary_name || `ESP32-CAM-${n.id}`,
          zone_a: n.zone_a ?? "WORKSPACE_FLOOR",
          zone_b: n.zone_b ?? "CORRIDOR_TRANSIT",
          is_online: n.is_online ?? true,
          fps: n.fps ?? 15,
          last_ping: new Date().toISOString(),
          boundary_coordinates: n.boundary_coordinates ?? { x1: 0, y1: 150, x2: 400, y2: 150 },
          firmware_version: n.firmware_version ?? "v1.0.0",
        };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("esp32_camera_nodes").upsert(node);
        if (error) {
          console.error("register-node upsert failed", error.message);
          return Response.json(
            { success: false, error: "Failed to register node" },
            { status: 500 },
          );
        }
        return Response.json({ success: true, message: "Node registered", node });
      },
    },
  },
});
