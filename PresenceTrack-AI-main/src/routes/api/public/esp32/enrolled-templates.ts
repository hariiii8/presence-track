import { createFileRoute } from "@tanstack/react-router";
import { rejectUnlessDevice } from "@/lib/device-key";

/**
 * Encrypted Biometric Template Distribution Endpoint for Edge Vision Gateways.
 *
 * Security & DPDP Act 2023 Compliance:
 * 1. Strictly requires x-device-key header matching ESP32_DEVICE_KEY.
 * 2. Only serves AES-256-GCM encrypted biometric envelopes (never plaintext vectors).
 * 3. Excludes deactivated employees.
 * 4. Flags employees with revoked consent so edge gateways can discard optical detections.
 */
export const Route = createFileRoute("/api/public/esp32/enrolled-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = rejectUnlessDevice(request, process.env["ESP32_DEVICE_KEY"]);
        if (denied) return denied;

        const { hasSupabaseAdminConfigured, supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        if (!hasSupabaseAdminConfigured()) {
          return Response.json(
            { success: false, error: "Database admin service key is not configured" },
            { status: 503 },
          );
        }

        try {
          // Fetch active employees with enrolled biometric templates
          const { data: users, error } = await supabaseAdmin
            .from("enterprise_users")
            .select("id, name, badge_id, enrolled_embedding, consent_revoked, is_active")
            .eq("is_active", true)
            .not("enrolled_embedding", "is", null);

          if (error) {
            console.error("Failed to fetch enrolled biometric templates:", error.message);
            return Response.json(
              { success: false, error: "Database error retrieving biometric templates" },
              { status: 500 },
            );
          }

          // Format template payload: templates are already AES-256-GCM encrypted envelopes
          const templates = (users || []).map((u) => ({
            employee_id: u.id,
            name: u.name,
            badge_id: u.badge_id,
            encrypted_envelope: u.enrolled_embedding,
            consent_revoked: u.consent_revoked ?? false,
            is_active: u.is_active ?? true,
          }));

          return Response.json({
            success: true,
            count: templates.length,
            synced_at: new Date().toISOString(),
            templates,
          });
        } catch (err) {
          console.error("Unexpected error in enrolled-templates handler:", err);
          return Response.json({ success: false, error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
