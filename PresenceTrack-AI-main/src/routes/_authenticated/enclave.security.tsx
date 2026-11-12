import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Settings, ShieldCheck, Activity } from "lucide-react";
import { isNodeLive } from "@/lib/ambient";
import { canAccessEnclave, enclavePathFor } from "@/lib/enclaves";
import { liveTelemetryQuery, nodesQuery, recentTransitsQuery } from "@/lib/queries";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { Esp32StreamGrid } from "@/components/presence/security/Esp32StreamGrid";
import { Esp32CanvasOverlay } from "@/components/presence/security/Esp32CanvasOverlay";
import { CameraConfigModal } from "@/components/presence/security/CameraConfigModal";
import { LiveTransitFeed } from "@/components/presence/security/LiveTransitFeed";
import { UnknownDetectionsList } from "@/components/presence/security/UnknownDetectionsList";
import { playTransitBlip } from "@/lib/sound-engine";

export const Route = createFileRoute("/_authenticated/enclave/security")({
  head: () => ({
    meta: [
      { title: "Physical Security Console — PresenceTrack AI" },
      {
        name: "description",
        content: "ESP32-CAM node matrix, boundary configuration and live optical transit stream.",
      },
      { property: "og:title", content: "Physical Security Console — PresenceTrack AI" },
      {
        property: "og:description",
        content: "ESP32-CAM node matrix, boundary configuration and live optical transit stream.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!canAccessEnclave(context.role, "security"))
      throw redirect({ to: enclavePathFor(context.role) });
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(nodesQuery()),
      context.queryClient.ensureQueryData(recentTransitsQuery()),
    ]);
  },
  component: SecurityEnclave,
});

function SecurityEnclave() {
  const { data: nodes } = useSuspenseQuery(nodesQuery());
  const { data: transits } = useSuspenseQuery(recentTransitsQuery());
  const { data: telemetry } = useQuery(liveTelemetryQuery());
  const queryClient = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [clearedAt, setClearedAt] = useState<number | null>(null);

  useRealtimeRefresh("esp32_camera_nodes", [["nodes"]]);
  useRealtimeRefresh("passive_transits", [["transits", "recent"]], { onInsert: playTransitBlip });
  useRealtimeRefresh("unknown_detections", [["unknown_detections"]]);

  const online = nodes.filter((n) => isNodeLive(n)).length;
  const feed = useMemo(
    () =>
      transits
        .filter((t) => clearedAt === null || new Date(t.timestamp).getTime() > clearedAt)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 100),
    [transits, clearedAt],
  );

  return (
    <div className="space-y-6">
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${online ? "animate-pulse bg-success" : "bg-warning"}`}
            />
            <span className="text-sm font-semibold text-umbra">
              {online}/{nodes.length} ESP32-CAM NODES ONLINE
            </span>
          </div>
          <div className="font-mono text-sm text-sage">
            Live telemetry stream | FPS: {nodes[0]?.fps ?? 15}
          </div>
        </div>
        <button type="button" onClick={() => setShowConfig(true)} className="glass-btn">
          <Settings className="h-4 w-4" /> Configure IP nodes
        </button>
      </div>

      <div className="glass-card">
        <Esp32StreamGrid nodes={nodes} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="glass-card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="stat-card-label">Optical Perimeter Monitor</span>
            <span className="flex items-center gap-1 text-xs text-sage">
              <Activity className="h-3.5 w-3.5 text-success-strong" /> Matrix Active
            </span>
          </div>
          <Esp32CanvasOverlay
            isLive={online > 0 || (telemetry?.is_live ?? false)}
            faceDetected={telemetry?.face_detected ?? false}
            faceBoundingBox={telemetry?.face_bounding_box ?? null}
            scScore={telemetry?.sc_score ?? 0}
            statusMessage={
              telemetry?.face_detected && telemetry.matched_name
                ? `Optical match: ${telemetry.matched_name}`
                : online > 0 || telemetry?.is_live
                  ? "Perimeter Active · Standby for transits"
                  : "No edge camera nodes online"
            }
          />
          <div className="mt-2 flex justify-between text-xs text-sage">
            <span
              className={
                online > 0 || telemetry?.is_live ? "text-success-strong" : "text-warning-strong"
              }
            >
              {online > 0 || telemetry?.is_live
                ? "Sensor stream connected"
                : "Awaiting hardware node heartbeat"}
            </span>
            <span className="font-mono">
              {telemetry?.active_tracks
                ? `${telemetry.active_tracks} track${telemetry.active_tracks > 1 ? "s" : ""} active`
                : "Real-time edge telemetry"}
            </span>
          </div>
        </div>

        <div className="space-y-3 lg:col-span-3">
          <h3 className="text-sm font-semibold text-umbra">
            Sub-millisecond optical transit stream
          </h3>
          <LiveTransitFeed
            transits={feed}
            onClear={() => {
              setClearedAt(Date.now());
            }}
          />
        </div>
      </div>

      {/* Unknown Detections & Alert Triage Feed */}
      <UnknownDetectionsList />

      <CameraConfigModal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        nodes={nodes}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["nodes"] })}
      />
    </div>
  );
}
