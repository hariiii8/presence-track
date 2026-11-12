import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APP_CONFIG, isNodeLive, type ZoneType } from "@/lib/ambient";
import type { Database } from "@/integrations/supabase/types";

const zoneEnum = z.enum([
  "WORKSPACE_FLOOR",
  "CAFETERIA_LOUNGE",
  "OUTDOOR_TERRACE",
  "CORRIDOR_TRANSIT",
]);

/** Verify caller has Physical Security or Super Admin role */
async function requireSecurityOrAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAllowed } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["security", "super_admin"],
  });
  if (!isAllowed) throw new Error("Forbidden: Security or Admin access required");
}

// ── Device Management Server Functions ──────────────────────────────────────

/** Register or update an ESP32-CAM camera node (Admin / Security). */
export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/),
        stream_url: z.string().trim().url().max(300),
        boundary_name: z.string().trim().max(120).optional(),
        zone_a: zoneEnum.default("CORRIDOR_TRANSIT"),
        zone_b: zoneEnum.default("WORKSPACE_FLOOR"),
        fps: z.number().min(1).max(60).default(15),
        boundary_coordinates: z
          .object({
            x1: z.number(),
            y1: z.number(),
            x2: z.number(),
            y2: z.number(),
          })
          .default({ x1: 0, y1: 150, x2: 400, y2: 150 }),
        firmware_version: z.string().trim().max(32).default("v1.0.0"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSecurityOrAdmin(context.supabase, context.userId);

    const nodeData = {
      id: data.id,
      stream_url: data.stream_url,
      boundary_name: data.boundary_name || `ESP32-CAM-${data.id}`,
      zone_a: data.zone_a as ZoneType,
      zone_b: data.zone_b as ZoneType,
      fps: data.fps,
      is_online: true,
      last_ping: new Date().toISOString(),
      boundary_coordinates: data.boundary_coordinates,
      firmware_version: data.firmware_version,
    };

    const { data: node, error } = await context.supabase
      .from("esp32_camera_nodes")
      .upsert(nodeData)
      .select("*")
      .single();

    if (error || !node) {
      throw new Error(error?.message || "Failed to register camera node");
    }

    return { success: true, node };
  });

/** Retrieve list of all camera nodes with live connectivity status. */
export const getDeviceStatusList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: nodes, error } = await context.supabase
      .from("esp32_camera_nodes")
      .select("*")
      .order("id", { ascending: true });

    if (error) throw new Error("Failed to load camera nodes");

    const now = Date.now();
    const enriched = (nodes ?? []).map((n) => {
      const live = isNodeLive(n, now);
      return {
        ...n,
        is_live: live,
        seconds_since_ping: n.last_ping
          ? Math.floor((now - new Date(n.last_ping).getTime()) / 1000)
          : null,
      };
    });

    const onlineCount = enriched.filter((n) => n.is_live).length;
    return {
      success: true,
      total: enriched.length,
      online_count: onlineCount,
      offline_count: enriched.length - onlineCount,
      nodes: enriched,
    };
  });

/** Record heartbeat ping for a device to update its last_seen timestamp. */
export const recordDeviceHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().trim().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase
      .from("esp32_camera_nodes")
      .update({
        last_ping: nowIso,
        is_online: true,
      })
      .eq("id", data.id);

    if (error) throw new Error("Failed to record device heartbeat");
    return { success: true, last_ping: nowIso };
  });

/** Deactivate or remove a camera node (Security / Admin). */
export const deactivateDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().trim().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSecurityOrAdmin(context.supabase, context.userId);

    const { error } = await context.supabase.from("esp32_camera_nodes").delete().eq("id", data.id);

    if (error) throw new Error("Failed to remove camera node");
    return { success: true, message: `Node ${data.id} removed successfully` };
  });
