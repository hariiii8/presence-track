import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { isNodeLive, type Esp32Node } from "@/lib/ambient";
import { cn } from "@/lib/utils";

/** Quadrant grid of ESP32-CAM boundary feeds. Streams are on the local network and open in a new tab. */
export function Esp32StreamGrid({ nodes }: { nodes: Esp32Node[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (nodes.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-sage">No ESP32-CAM nodes registered yet.</div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {nodes.map((node, i) => {
        const live = isNodeLive(node);
        const isSel = selected === node.id;
        return (
          <div key={node.id} className="group overflow-hidden rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setSelected(isSel ? null : node.id)}
              className="relative block aspect-video w-full overflow-hidden bg-stage text-left"
            >
              <div className="absolute inset-0 flex items-center justify-center text-center font-mono text-sm text-stage-foreground/30">
                ESP32-CAM Node {i + 1}
                <br />
                {live ? "LIVE" : "OFFLINE"}
              </div>
              {live && <div className="absolute inset-0 border-2 border-penna/30" />}
              <div
                className={cn(
                  "absolute top-2 left-2 flex items-center gap-1.5 text-xs font-medium",
                  live ? "text-success" : "text-warning",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    live ? "animate-pulse bg-success" : "bg-warning",
                  )}
                />
                {live ? "LIVE" : "OFFLINE"}
              </div>
              <div className="absolute right-2 bottom-2 left-2 truncate rounded bg-stage/80 px-2 py-1 text-xs text-stage-foreground">
                {node.id} — {node.boundary_name}
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-stage/0 opacity-0 transition group-hover:bg-stage/30 group-hover:opacity-100">
                <span className="flex items-center gap-2 rounded bg-stage/60 px-3 py-1.5 text-sm text-stage-foreground">
                  {isSel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {isSel ? "Hide details" : "View node"}
                </span>
              </div>
            </button>
            {isSel && (
              <div className="space-y-1 bg-card p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-sage">FPS</span>
                  <span className="font-mono">{node.fps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sage">Last ping</span>
                  <span className="font-mono">
                    {node.last_ping
                      ? new Date(node.last_ping).toLocaleTimeString("en-IN")
                      : "never"}
                  </span>
                </div>
                <a
                  href={node.stream_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-success-strong underline"
                >
                  {node.stream_url}
                </a>
                <p className="text-xxs text-sage">
                  The MJPEG feed is served on the office network and opens from a device on that
                  network.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
