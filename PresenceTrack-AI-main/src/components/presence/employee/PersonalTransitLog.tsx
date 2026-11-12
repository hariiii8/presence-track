import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { PassiveTransit } from "@/lib/ambient";
import { ZONE_LABELS } from "@/lib/ambient";
import { cn } from "@/lib/utils";

/** The employee's own boundary transits with copyable vector hashes. */
export function PersonalTransitLog({ transits }: { transits: PassiveTransit[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (transits.length === 0) {
    return (
      <div className="rounded-xl bg-muted p-6 text-center text-sm text-sage">
        No boundary transits recorded yet.
      </div>
    );
  }

  const copy = async (t: PassiveTransit) => {
    await navigator.clipboard.writeText(t.vector_hash);
    setCopied(t.id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="overflow-x-auto">
      <table className="table-glass">
        <thead>
          <tr>
            <th>Time</th>
            <th>Camera node</th>
            <th>Boundary</th>
            <th>Cosine (Sc)</th>
            <th>DRAM scrub</th>
            <th>Vector hash</th>
          </tr>
        </thead>
        <tbody>
          {transits.map((t) => (
            <tr key={t.id}>
              <td className="font-mono text-xs text-umbra">
                {new Date(t.timestamp).toLocaleString("en-IN", {
                  hour12: false,
                  timeZone: "Asia/Kolkata",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </td>
              <td className="text-xs text-umbra">{t.camera_id ?? "—"}</td>
              <td>
                <span
                  className={cn(
                    "pill",
                    t.direction === "ZONE_ENTER"
                      ? "bg-success-soft text-success-strong"
                      : "bg-warning-soft text-warning-strong",
                  )}
                >
                  {t.direction === "ZONE_ENTER" ? "→ Enter" : "← Exit"} {ZONE_LABELS[t.zone_to]}
                </span>
              </td>
              <td className="font-mono text-xs">{Number(t.cosine_score).toFixed(4)}</td>
              <td className="font-mono text-xs text-sage">{t.dram_scrub_ms}ms</td>
              <td>
                <button
                  type="button"
                  onClick={() => copy(t)}
                  className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs text-sage transition hover:text-umbra"
                >
                  {copied === t.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied === t.id ? "Copied" : t.vector_hash.slice(0, 8)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
