import { isNodeLive, ZONE_LABELS, type Esp32Node } from "@/lib/ambient";
import { cn } from "@/lib/utils";

/** Edge node attestation tiles: heartbeat-based liveness. */
export function HardwareNodeGrid({ nodes }: { nodes: Esp32Node[] }) {
  if (nodes.length === 0)
    return <div className="p-6 text-center text-sm text-sage">No edge nodes registered.</div>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {nodes.map((node) => {
        const live = isNodeLive(node);
        return (
          <div key={node.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-umbra">{node.id}</span>
              <span
                className={cn(
                  "pill",
                  live
                    ? "bg-success-soft text-success-strong"
                    : "bg-warning-soft text-warning-strong",
                )}
              >
                {live ? "VERIFIED" : "OFFLINE"}
              </span>
            </div>
            <div className="mb-1 truncate text-xs text-sage">{node.boundary_name}</div>
            <div className="mb-3 text-xxs text-sage">
              {ZONE_LABELS[node.zone_a]} → {ZONE_LABELS[node.zone_b]}
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-sage">FPS</span>
                <span className="font-mono">{node.fps}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sage">Last heartbeat</span>
                <span className="font-mono">
                  {node.last_ping ? new Date(node.last_ping).toLocaleTimeString("en-IN") : "—"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
