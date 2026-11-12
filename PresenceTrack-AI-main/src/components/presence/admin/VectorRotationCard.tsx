import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ROTATION_DAYS = 30;
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function rotationState(now: number) {
  const elapsed = Math.floor((now - EPOCH) / DAY);
  const current = Math.floor(elapsed / ROTATION_DAYS) + 1;
  const next = EPOCH + current * ROTATION_DAYS * DAY;
  const daysLeft = Math.ceil((next - now) / DAY);
  const status = daysLeft <= 0 ? "EXPIRED" : daysLeft <= 7 ? "EXPIRING_SOON" : "ACTIVE";
  return { current, next: new Date(next), daysLeft, status } as const;
}

/** 30-day template-key rotation schedule. */
export function VectorRotationCard() {
  const [state, setState] = useState<ReturnType<typeof rotationState> | null>(null);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    const tick = () => setState(rotationState(Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!state) return <div className="h-40" />;
  const tone =
    state.status === "ACTIVE"
      ? { pill: "bg-success-soft text-success-strong", bar: "bg-success" }
      : state.status === "EXPIRING_SOON"
        ? { pill: "bg-warning-soft text-warning-strong", bar: "bg-warning" }
        : { pill: "bg-destructive-soft text-destructive", bar: "bg-destructive" };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="stat-card-label">Template key rotation</span>
        <span className={cn("pill", tone.pill)}>{state.status.replace("_", " ")}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-sage">Rotation #{state.current}</span>
        <span className="font-mono text-sm text-umbra">
          {state.next.toISOString().slice(0, 10)}
        </span>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-sage">
          <span>Countdown to next rotation</span>
          <span>{state.daysLeft} days</span>
        </div>
        <div className="timeline-rail">
          <div
            className={cn("h-full rounded-sm transition-all duration-1000", tone.bar)}
            style={{ width: `${Math.max((state.daysLeft / ROTATION_DAYS) * 100, 0)}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setRotating(true);
          setTimeout(() => setRotating(false), 2500);
        }}
        disabled={state.status === "ACTIVE" || rotating}
        className="glass-btn mt-4"
      >
        {rotating
          ? "Rotating…"
          : state.status === "ACTIVE"
            ? `Next rotation in ${state.daysLeft} days`
            : "Rotate now"}
      </button>
    </div>
  );
}
