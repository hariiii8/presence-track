import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, ShieldAlert, CheckCircle2 } from "lucide-react";
import { manualCheckInFallback } from "@/lib/attendance.functions";
import { ZONE_LABELS, type EnterpriseUser } from "@/lib/ambient";

interface ManualPunchCardProps {
  profile: EnterpriseUser;
  onSuccess?: () => void;
}

export function ManualPunchCard({ profile, onSuccess }: ManualPunchCardProps) {
  const queryClient = useQueryClient();
  const punchFn = useServerFn(manualCheckInFallback);
  const [submitting, setSubmitting] = useState(false);
  const [direction, setDirection] = useState<"ZONE_ENTER" | "ZONE_EXIT">("ZONE_ENTER");
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const isInside = profile.current_zone === "WORKSPACE_FLOOR";

  const handleTriggerPunch = (dir: "ZONE_ENTER" | "ZONE_EXIT") => {
    setDirection(dir);
    setShowConfirm(true);
  };

  const executePunch = async () => {
    setSubmitting(true);
    setShowConfirm(false);
    try {
      const res = await punchFn({
        data: {
          direction,
          notes: notes.trim() || undefined,
        },
      });

      if (res.success) {
        toast.success(
          direction === "ZONE_ENTER"
            ? "Manual Clock-In recorded. Welcome to workspace!"
            : "Manual Clock-Out recorded. Have a safe journey!",
        );
        setNotes("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["dwell", "me"] }),
          queryClient.invalidateQueries({ queryKey: ["transits", "me"] }),
          queryClient.invalidateQueries({ queryKey: ["attendance"] }),
          queryClient.invalidateQueries({ queryKey: ["personnel"] }),
        ]);
        onSuccess?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record manual punch";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="stat-card-label">DPDP Non-Biometric Attendance Fallback</span>
            <span className="pill bg-muted/60 text-xxs font-mono text-sage">SEC. 12 FALLBACK</span>
          </div>
          <p className="mt-1 text-xs text-sage">
            Under DPDP Act 2023, employees may record presence manually without optical biometric
            telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-border/40 bg-muted/30 px-3 py-1.5 text-right">
            <div className="text-xxs text-sage">Current Presence</div>
            <div className="font-mono text-xs font-semibold text-umbra">
              {profile.current_zone ? ZONE_LABELS[profile.current_zone] : "Off Premise"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-border/30 pt-4">
        {showConfirm ? (
          <div className="rounded-xl border border-warning-strong/30 bg-warning-soft/60 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-warning-strong" />
              <div className="flex-1 text-xs text-umbra">
                <div className="font-semibold">
                  Confirm Manual {direction === "ZONE_ENTER" ? "Clock-In" : "Clock-Out"}
                </div>
                <p className="mt-1 text-sage">
                  This records a tamper-evident audit transit timestamped at{" "}
                  <strong>{new Date().toLocaleTimeString()}</strong> in IST.
                </p>

                <div className="mt-3">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional note / reason for manual punch…"
                    className="glass-input w-full py-1.5 text-xs"
                    maxLength={150}
                  />
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={executePunch}
                    disabled={submitting}
                    className="glass-btn-primary py-1.5 text-xs"
                  >
                    {submitting ? "Sealing…" : "Confirm & Record"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    disabled={submitting}
                    className="glass-btn py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={submitting || isInside}
              onClick={() => handleTriggerPunch("ZONE_ENTER")}
              className={`glass-btn flex items-center gap-2 py-2 text-xs font-semibold ${
                !isInside
                  ? "border-success/40 bg-success-soft text-success-strong hover:bg-success/20"
                  : "opacity-40"
              }`}
            >
              <LogIn className="h-4 w-4" />
              Manual Clock-In (Enter Workspace)
            </button>

            <button
              type="button"
              disabled={submitting || !isInside}
              onClick={() => handleTriggerPunch("ZONE_EXIT")}
              className={`glass-btn flex items-center gap-2 py-2 text-xs font-semibold ${
                isInside
                  ? "border-warning/40 bg-warning-soft text-warning-strong hover:bg-warning/20"
                  : "opacity-40"
              }`}
            >
              <LogOut className="h-4 w-4" />
              Manual Clock-Out (Exit Workspace)
            </button>

            {isInside && (
              <span className="flex items-center gap-1 text-xxs text-success-strong">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Clocked In
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
