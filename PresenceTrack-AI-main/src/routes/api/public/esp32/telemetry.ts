import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rejectUnlessDevice } from "@/lib/device-key";

const BoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
    w: z.number().min(1).max(4000),
    h: z.number().min(1).max(4000),
  })
  .refine((box) => box.x + box.w <= 4000 && box.y + box.h <= 4000, {
    message: "Bounding box coordinates exceed frame boundary limits",
  });

const TelemetryPayloadSchema = z.object({
  camera_id: z.string().trim().min(1).max(64),
  is_live: z.boolean(),
  face_detected: z.boolean(),
  face_bounding_box: BoundingBoxSchema.nullable().optional(),
  sc_score: z.number().min(0).max(1).optional(),
  matched_name: z.string().trim().max(120).nullable().optional(),
  person_count: z.number().int().min(0).max(100).optional(),
  active_tracks: z.number().int().min(0).max(100).optional(),
  last_event: z.string().trim().max(64).nullable().optional(),
  timestamp: z.string().datetime().optional(),
  event_nonce: z.string().trim().max(64).optional(),
});

export interface LiveTelemetryState {
  camera_id: string;
  is_live: boolean;
  face_detected: boolean;
  face_bounding_box: { x: number; y: number; w: number; h: number } | null;
  sc_score: number;
  matched_name: string | null;
  person_count: number;
  active_tracks: number;
  last_event: string | null;
  updated_at: string;
}

// In-memory latest telemetry state from Edge Vision Gateway
let currentTelemetry: LiveTelemetryState = {
  camera_id: "ESP32-CAM-01-NORTH",
  is_live: false,
  face_detected: false,
  face_bounding_box: null,
  sc_score: 0,
  matched_name: null,
  person_count: 0,
  active_tracks: 0,
  last_event: null,
  updated_at: new Date().toISOString(),
};

// Seen nonce cache for replay protection
const seenNonces = new Map<string, number>();

function pruneOldNonces() {
  const cutoff = Date.now() - 60000; // 60 seconds (strictly exceeds the 30s skew window)
  for (const [nonce, ts] of seenNonces.entries()) {
    if (ts < cutoff) {
      seenNonces.delete(nonce);
    }
  }
}

export const Route = createFileRoute("/api/public/esp32/telemetry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Enforce strict authorization: Security or Super Admin session required
        // Device keys are strictly prohibited from retrieving optical perimeter telemetry
        const deviceKeyHeader = request.headers.get("x-device-key");
        const authHeader = request.headers.get("authorization");
        const cookieHeader = request.headers.get("cookie");

        if (deviceKeyHeader && !authHeader && !cookieHeader) {
          return Response.json(
            {
              success: false,
              error:
                "Device key cannot authorize telemetry retrieval; Security or Super Admin session required",
            },
            { status: 403 },
          );
        }

        if (!authHeader && !cookieHeader) {
          return Response.json(
            {
              success: false,
              error: "Unauthorized access to optical perimeter telemetry: Session required",
            },
            { status: 401 },
          );
        }

        let token: string | null = null;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.slice(7).trim();
        } else if (cookieHeader) {
          const match = cookieHeader.match(
            /(?:sb-[^;]+-auth-token|sb-access-token|access_token)=([^;]+)/,
          );
          if (match && match[1]) {
            token = decodeURIComponent(match[1]);
          }
        }

        if (!token) {
          return Response.json(
            { success: false, error: "Unauthorized: Invalid session credentials" },
            { status: 401 },
          );
        }

        const { hasSupabaseAdminConfigured, supabaseAdmin } =
          await import("@/integrations/supabase/client.server");

        if (hasSupabaseAdminConfigured()) {
          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData?.user) {
            return Response.json(
              { success: false, error: "Unauthorized: Invalid or expired session token" },
              { status: 401 },
            );
          }

          const { data: hasRole, error: roleError } = await supabaseAdmin.rpc("has_any_role", {
            _user_id: userData.user.id,
            _roles: ["security", "super_admin"],
          });

          if (roleError || !hasRole) {
            return Response.json(
              {
                success: false,
                error:
                  "Forbidden: Security or Super Admin role required to retrieve optical perimeter telemetry",
              },
              { status: 403 },
            );
          }
        }

        // Return sanitized telemetry (sensitive biometric vectors are strictly omitted)
        return Response.json({
          success: true,
          telemetry: {
            camera_id: currentTelemetry.camera_id,
            is_live: currentTelemetry.is_live,
            face_detected: currentTelemetry.face_detected,
            face_bounding_box: currentTelemetry.face_bounding_box,
            sc_score: currentTelemetry.sc_score,
            matched_name: currentTelemetry.matched_name,
            person_count: currentTelemetry.person_count,
            active_tracks: currentTelemetry.active_tracks,
            last_event: currentTelemetry.last_event,
            updated_at: currentTelemetry.updated_at,
          },
        });
      },
      POST: async ({ request }) => {
        const denied = rejectUnlessDevice(request, process.env["ESP32_DEVICE_KEY"]);
        if (denied) return denied;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ success: false, error: "Invalid JSON" }, { status: 400 });
        }

        const parsed = TelemetryPayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            {
              success: false,
              error: "Invalid telemetry payload or out-of-bounds coordinates",
              details: parsed.error.format(),
            },
            { status: 400 },
          );
        }

        const d = parsed.data;

        // Replay protection: validate timestamp within ±30s window
        if (d.timestamp) {
          const ts = new Date(d.timestamp).getTime();
          const now = Date.now();
          if (Number.isNaN(ts) || Math.abs(now - ts) > 30000) {
            return Response.json(
              {
                success: false,
                error: "Expired or skewed telemetry timestamp (replay protection: window is ±30s)",
              },
              { status: 400 },
            );
          }
        }

        // Nonce deduplication
        if (d.event_nonce) {
          pruneOldNonces();
          if (seenNonces.has(d.event_nonce)) {
            return Response.json(
              { success: true, debounced: true, message: "Duplicate telemetry nonce suppressed" },
              { status: 200 },
            );
          }
          seenNonces.set(d.event_nonce, Date.now());
        }

        currentTelemetry = {
          camera_id: d.camera_id,
          is_live: d.is_live,
          face_detected: d.face_detected,
          face_bounding_box: d.face_bounding_box ?? null,
          sc_score: d.sc_score ?? 0,
          matched_name: d.matched_name ?? null,
          person_count: d.person_count ?? 0,
          active_tracks: d.active_tracks ?? 0,
          last_event: d.last_event ?? null,
          updated_at: new Date().toISOString(),
        };

        return Response.json({ success: true, message: "Telemetry received" });
      },
    },
  },
});
