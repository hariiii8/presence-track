import { Zap } from "lucide-react";
import { ZONE_LABELS, type TransitWithPerson } from "@/lib/ambient";
import { cn } from "@/lib/utils";

/** Scrolling feed of automatic boundary passes (HH:mm:ss.SSS). */
export function LiveTransitFeed({
  transits,
  onClear,
}: {
  transits: TransitWithPerson[];
  onClear: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-success" />
          <span className="text-sm font-semibold text-umbra">Optic transit stream</span>
          <span className="text-xxs text-sage">HH:mm:ss.SSS (UTC)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-sage">{transits.length} events</span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-sage transition hover:text-umbra"
          >
            Clear view
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto px-3">
        {transits.length === 0 ? (
          <div className="p-6 text-center text-sm text-sage">
            No boundary transits recorded yet.
          </div>
        ) : (
          transits.map((t, i) => (
            <div
              key={t.id}
              className="transit-row"
              style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}
            >
              <div className="w-24 shrink-0 font-mono text-xs text-umbra">
                {new Date(t.timestamp).toISOString().slice(11, 23)}
              </div>
              <div className="w-32 shrink-0 truncate text-xs text-umbra">
                {t.enterprise_users?.name ?? "Unregistered / Visitor"}
              </div>
              <div className="hidden w-36 shrink-0 truncate text-xs text-sage md:block">
                {t.camera_id ?? "—"}
              </div>
              <div className="min-w-0 flex-1 truncate text-xs">
                <span
                  className={cn(
                    "font-semibold",
                    t.direction === "ZONE_ENTER" ? "text-success-strong" : "text-warning-strong",
                  )}
                >
                  {t.direction === "ZONE_ENTER" ? "→" : "←"}
                </span>{" "}
                {ZONE_LABELS[t.zone_from]} → {ZONE_LABELS[t.zone_to]}
              </div>
              <div className="w-16 shrink-0 font-mono text-xs text-sage">
                {Number(t.cosine_score).toFixed(4)}
              </div>
              <div className="hidden w-14 shrink-0 font-mono text-xs text-umbra sm:block">
                {t.dram_scrub_ms}ms
              </div>
              <div className="hidden w-24 shrink-0 font-mono text-xs text-sage lg:block">
                {t.vector_hash.slice(0, 10)}…
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
