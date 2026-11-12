import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/** Ensure caller is Super Admin */
async function requireSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (!isAdmin) throw new Error("Forbidden: Super Admin access required");
}

/** Ensure caller is Security or Super Admin */
async function requireSecurityOrAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAllowed } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["security", "super_admin"],
  });
  if (!isAllowed) throw new Error("Forbidden: Security or Admin access required");
}

// ── Audit & Security Server Functions ───────────────────────────────────────

/** Retrieve administrative audit trail (Super Admin only). */
export const getAdminAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(200).default(50),
        entity_type: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    let query = context.supabase
      .from("admin_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.entity_type) {
      query = query.eq("entity_type", data.entity_type);
    }

    const { data: logs, error } = await query;
    if (error) throw new Error("Failed to load audit logs");

    return { success: true, logs: logs ?? [] };
  });

/** Retrieve unknown person detections / security alerts (Security / Admin). */
export const getUnknownDetections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        status: z.enum(["ALL", "PENDING", "REVIEWED", "DISMISSED"]).default("PENDING"),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSecurityOrAdmin(context.supabase, context.userId);

    let query = context.supabase
      .from("unknown_detections")
      .select("*, esp32_camera_nodes(boundary_name)")
      .order("detected_at", { ascending: false })
      .limit(data.limit);

    if (data.status !== "ALL") {
      query = query.eq("reviewed_status", data.status);
    }

    const { data: detections, error } = await query;
    if (error) throw new Error("Failed to load unknown detections");

    return { success: true, detections: detections ?? [] };
  });

/** Review and resolve an unknown person detection alert (Security / Admin). */
export const resolveUnknownDetection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["REVIEWED", "DISMISSED"]),
        notes: z.string().trim().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSecurityOrAdmin(context.supabase, context.userId);

    const { error } = await context.supabase
      .from("unknown_detections")
      .update({
        reviewed_status: data.status,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        notes: data.notes || null,
      })
      .eq("id", data.id);

    if (error) throw new Error("Failed to resolve detection alert");
    return { success: true, message: `Alert marked as ${data.status.toLowerCase()}` };
  });
