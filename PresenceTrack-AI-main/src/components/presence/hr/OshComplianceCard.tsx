import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { APP_CONFIG } from "@/lib/ambient";
import { playClick, playWarningBeep } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";

interface OshComplianceCardProps {
  /** Longest continuous desk stretch today, across the team. */
  longest: { name: string; minutes: number; compliant: boolean } | null;
}

/** Flags continuous desk sitting beyond 4.5h without an ergonomic break (OSH Code). */
export function OshComplianceCard({ longest }: OshComplianceCardProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const hours = (longest?.minutes ?? 0) / 60;
  const flagged =
    !!longest && (longest.minutes > APP_CONFIG.oshSittingThresholdMinutes || !longest.compliant);

  return (
    <div className={cn("glass-card", acknowledged && "opacity-70")}>
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-card-label">OSH Code fatigue alert</span>
        <span
          className={cn(
            "text-xs font-semibold",
            flagged ? "text-warning-strong" : "text-success-strong",
          )}
        >
          {flagged ? "REVIEW REQUIRED" : "PASS"}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="mb-1 flex justify-between text-xs text-sage">
            <span>Longest continuous desk sitting{longest ? ` · ${longest.name}` : ""}</span>
          </div>
          <div className="timeline-rail">
            <div
              className={cn(
                "h-full rounded-sm transition-all",
                hours > 8 ? "bg-destructive" : hours > 4.5 ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${Math.min((hours / 8) * 100, 100)}%` }}
            />
          </div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "font-mono text-3xl font-bold",
              flagged ? "text-warning-strong" : "text-success-strong",
            )}
          >
            {hours.toFixed(1)}h
          </div>
          <div className="text-xs text-sage">sitting time</div>
        </div>
      </div>

      {flagged && !acknowledged && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning-strong" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-warning-strong">OSH alert: extended sitting</p>
            <p className="text-xs text-warning-strong">
              Continuous desk sitting exceeds the 4.5h statutory ergonomic break threshold.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playClick();
              playWarningBeep();
              setAcknowledged(true);
            }}
            className="glass-btn px-3 py-1 text-xs"
          >
            Acknowledge
          </button>
        </div>
      )}
      {acknowledged && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-success-soft p-2 text-xs text-success-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Alert acknowledged. Reminder: stand, hydrate and stretch every 4.5h.
        </div>
      )}
    </div>
  );
}
