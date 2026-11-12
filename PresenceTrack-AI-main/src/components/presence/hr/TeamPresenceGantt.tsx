import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TeamMember {
  id: string;
  name: string;
  badgeId: string;
  workspaceMin: number;
  breakMin: number;
}

const DAY_SPAN_MIN = 12 * 60; // 08:00–20:00 horizon

/** Team schedule populated from ESP32-CAM boundary transits. */
export function TeamPresenceGantt({ members }: { members: TeamMember[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const q = search.toLowerCase();
  const filtered = members.filter(
    (m) => m.name.toLowerCase().includes(q) || m.badgeId.toLowerCase().includes(q),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-sage">Auto-populated from ESP32-CAM boundary transits</span>
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-sage" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or badge…"
            className="glass-input w-56 py-2 pl-8 text-xs"
          />
        </label>
      </div>

      <div className="mb-1 mr-[7.25rem] ml-[11.25rem] hidden justify-between font-mono text-xxs text-sage sm:flex">
        <span>08:00</span>
        <span>11:00</span>
        <span>14:00</span>
        <span>17:00</span>
        <span>20:00</span>
      </div>

      <div className="space-y-1.5">
        {filtered.map((m) => {
          const wPct = Math.min((m.workspaceMin / DAY_SPAN_MIN) * 100, 100);
          const bPct = Math.min((m.breakMin / DAY_SPAN_MIN) * 100, 100 - wPct);
          const isSel = selected === m.id;
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => setSelected(isSel ? null : m.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition",
                isSel
                  ? "border-success/40 bg-success-soft"
                  : "border-border bg-muted hover:bg-glass-strong",
              )}
            >
              <div className="w-40 shrink-0 truncate text-xs text-umbra">
                {m.name} <span className="font-mono text-sage">({m.badgeId})</span>
              </div>
              <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-card">
                <div className="h-full bg-success" style={{ width: `${wPct}%` }} />
                <div className="h-full bg-warning" style={{ width: `${bPct}%` }} />
              </div>
              <div className="w-24 shrink-0 text-right font-mono text-xxs text-sage">
                {Math.floor(m.workspaceMin / 60)}h{m.workspaceMin % 60}m · {m.breakMin}m
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="p-4 text-center text-sm text-sage">
          {members.length === 0
            ? "No personnel detected today yet."
            : "No team members match your search."}
        </div>
      )}
    </div>
  );
}
