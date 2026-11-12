import type { PassiveTransit } from "@/lib/ambient";
import { cn } from "@/lib/utils";

interface PersonalTimelineProps {
  transits: Pick<PassiveTransit, "timestamp" | "zone_to">[];
  oshCompliant: boolean;
}

const START_HOUR = 8;
const HOURS = 12;

function istHourMinutes(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** 08:00–20:00 horizon populated strictly by ESP32-CAM detections. */
export function PersonalTimeline({ transits, oshCompliant }: PersonalTimelineProps) {
  const ordered = [...transits]
    .map((t) => ({ minute: istHourMinutes(t.timestamp), zone: t.zone_to }))
    .sort((a, b) => a.minute - b.minute);

  const segments = Array.from({ length: HOURS }, (_, i) => {
    const hour = START_HOUR + i;
    const mid = hour * 60 + 30;
    const last = ordered.filter((t) => t.minute <= mid).at(-1);
    const state = !last
      ? "absent"
      : last.zone === "WORKSPACE_FLOOR"
        ? "workspace"
        : last.zone === "CORRIDOR_TRANSIT"
          ? "absent"
          : "break";
    const count = ordered.filter((t) => t.minute >= hour * 60 && t.minute < (hour + 1) * 60).length;
    return { hour, state, count };
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-card-label">
          Today ·{" "}
          {new Date().toLocaleDateString("en-IN", {
            month: "short",
            day: "numeric",
            timeZone: "Asia/Kolkata",
          })}
        </span>
        <span
          className={cn(
            "text-xs font-semibold",
            oshCompliant ? "text-success-strong" : "text-warning-strong",
          )}
        >
          OSH compliance: {oshCompliant ? "PASS" : "FLAG"}
        </span>
      </div>
      <div className="timeline-rail h-3 gap-px">
        {segments.map((s) => (
          <div
            key={s.hour}
            className={cn(
              "h-full flex-1 transition-colors",
              s.state === "workspace" && "bg-umbra",
              s.state === "break" && "bg-warning",
              s.state === "absent" && "bg-transparent",
            )}
            title={`${s.hour}:00 — ${s.state} (${s.count} transits)`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs text-sage">
        <span>08:00</span>
        <span>12:00</span>
        <span>16:00</span>
        <span>20:00</span>
      </div>
      <div className="mt-1 flex gap-4 text-xxs text-sage">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-umbra" /> Deep work
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-warning" /> Break / aux
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-muted ring-1 ring-border" /> Off-site
        </span>
      </div>
    </div>
  );
}
