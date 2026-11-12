import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rejectUnlessDevice } from "@/lib/device-key";
import { sha256Hex } from "@/lib/merkle";

const zone = z.enum(["WORKSPACE_FLOOR", "CAFETERIA_LOUNGE", "OUTDOOR_TERRACE", "CORRIDOR_TRANSIT"]);

const TransitSchema = z.object({
  camera_id: z.string().trim().min(1).max(64),
  user_id: z.string().uuid(),
  zone_from: zone,
  zone_to: zone,
  direction: z.enum(["ZONE_ENTER", "ZONE_EXIT"]),
  cosine_score: z.number().min(0).max(1),
  dram_scrub_ms: z.number().min(0).max(999),
  vector_hash: z.string().trim().max(256).optional(),
});

/** Boundary transit telemetry from an ESP32-CAM node. Requires the x-device-key header. */
export const Route = createFileRoute("/api/public/esp32/boundary-transit")({
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
        const parsed = TransitSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { success: false, error: "Invalid transit payload" },
            { status: 400 },
          );
        }
        const t = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Unknown person / low confidence handling
        if (t.cosine_score < 0.7) {
          const vectorHash = await sha256Hex(t.vector_hash || crypto.randomUUID());
          await supabaseAdmin.from("unknown_detections").insert({
            device_id: t.camera_id,
            zone_id: t.zone_to,
            detection_confidence: t.cosine_score,
            frame_hash: vectorHash,
            reviewed_status: "PENDING",
            notes: `Detection below 0.70 threshold (${t.cosine_score.toFixed(4)})`,
          });
          return Response.json(
            {
              success: false,
              error: "Cosine score below match threshold (0.7000)",
              unknown_alert_logged: true,
            },
            { status: 422 },
          );
        }

        const { data: person } = await supabaseAdmin
          .from("enterprise_users")
          .select("id, consent_revoked, is_active")
          .eq("id", t.user_id)
          .maybeSingle();
        if (!person || !person.is_active)
          return Response.json(
            { success: false, error: "Unknown or inactive enrolled user" },
            { status: 404 },
          );
        if (person.consent_revoked) {
          // DPDP Sec. 12: no further optical detections are processed after revocation.
          return Response.json(
            { success: false, error: "Consent revoked — detection discarded" },
            { status: 403 },
          );
        }

        // Duplicate event suppression / debouncing (within 3 seconds)
        const threeSecondsAgo = new Date(Date.now() - 3000).toISOString();
        const { data: recentDuplicate } = await supabaseAdmin
          .from("passive_transits")
          .select("id, timestamp")
          .eq("user_id", t.user_id)
          .eq("direction", t.direction)
          .eq("zone_to", t.zone_to)
          .gte("timestamp", threeSecondsAgo)
          .limit(1)
          .maybeSingle();

        if (recentDuplicate) {
          return Response.json({
            success: true,
            debounced: true,
            message: "Duplicate transit suppressed (debounced)",
            prior_transit_id: recentDuplicate.id,
          });
        }

        const { data: camera } = await supabaseAdmin
          .from("esp32_camera_nodes")
          .select("id")
          .eq("id", t.camera_id)
          .maybeSingle();

        const vectorHash = await sha256Hex(t.vector_hash || crypto.randomUUID());
        const { data: inserted, error } = await supabaseAdmin
          .from("passive_transits")
          .insert({
            user_id: t.user_id,
            camera_id: camera?.id ?? null,
            zone_from: t.zone_from,
            zone_to: t.zone_to,
            direction: t.direction,
            cosine_score: t.cosine_score,
            dram_scrub_ms: t.dram_scrub_ms,
            vector_hash: vectorHash,
          })
          .select("id, timestamp")
          .single();
        if (error || !inserted) {
          console.error("boundary-transit insert failed", error?.message);
          return Response.json(
            { success: false, error: "Failed to record transit" },
            { status: 500 },
          );
        }

        return Response.json({
          success: true,
          message: "Transit recorded",
          transit_id: inserted.id,
          timestamp: inserted.timestamp,
          vector_hash: vectorHash,
        });
      },
    },
  },
});
