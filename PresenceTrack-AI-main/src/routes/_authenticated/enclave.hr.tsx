import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { APP_CONFIG, todayIST, ZONE_LABELS, ZONES } from "@/lib/ambient";
import { canAccessEnclave, enclavePathFor } from "@/lib/enclaves";
import { personnelQuery, teamDwellQuery, todayTransitsQuery } from "@/lib/queries";
import { exportPresenceCsv } from "@/lib/presence.functions";
import { downloadText } from "@/lib/download";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { ZoneOccupancyGrid } from "@/components/presence/hr/ZoneOccupancyGrid";
import { TeamPresenceGantt, type TeamMember } from "@/components/presence/hr/TeamPresenceGantt";
import { OshComplianceCard } from "@/components/presence/hr/OshComplianceCard";
import { WorkforceAttendanceTable } from "@/components/presence/hr/WorkforceAttendanceTable";
import { playClick } from "@/lib/sound-engine";

export const Route = createFileRoute("/_authenticated/enclave/hr")({
  head: () => ({
    meta: [
      { title: "HR Operations Console — PresenceTrack AI" },
      {
        name: "description",
        content: "Workforce concourse presence, team dwell Gantt, OSH alerts and CSV exports.",
      },
      { property: "og:title", content: "HR Operations Console — PresenceTrack AI" },
      {
        property: "og:description",
        content: "Workforce concourse presence, team dwell Gantt, OSH alerts and CSV exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!canAccessEnclave(context.role, "hr")) throw redirect({ to: enclavePathFor(context.role) });
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(personnelQuery()),
      context.queryClient.ensureQueryData(teamDwellQuery()),
      context.queryClient.ensureQueryData(todayTransitsQuery()),
    ]);
  },
  component: HrEnclave,
});

function istHour(iso: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso)),
  );
}

function HrEnclave() {
  const { profile } = Route.useRouteContext();
  const { data: people } = useSuspenseQuery(personnelQuery());
  const { data: dwell } = useSuspenseQuery(teamDwellQuery());
  const { data: transits } = useSuspenseQuery(todayTransitsQuery());
  const [date, setDate] = useState(todayIST());
  const [exporting, setExporting] = useState(false);
  const exportCsv = useServerFn(exportPresenceCsv);

  useRealtimeRefresh("passive_transits", [["transits", "today"], ["dwell", "team"], ["personnel"]]);

  const detectedToday = new Set(dwell.map((d) => d.user_id));
  const present = people.filter(
    (p) => detectedToday.has(p.id) && p.current_zone && p.current_zone !== "CORRIDOR_TRANSIT",
  );
  const workspaceCount = present.filter((p) => p.current_zone === "WORKSPACE_FLOOR").length;
  const commonCount = present.length - workspaceCount;

  const perHour = new Map<number, number>();
  for (const t of transits) {
    if (t.direction !== "ZONE_ENTER") continue;
    const h = istHour(t.timestamp);
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  let peak = { count: 0, hour: null as number | null };
  for (const [hour, count] of perHour) if (count > peak.count) peak = { count, hour };

  const byId = new Map(people.map((p) => [p.id, p]));
  const members: TeamMember[] = dwell
    .map((d) => {
      const p = byId.get(d.user_id);
      return p
        ? {
            id: p.id,
            name: p.name,
            badgeId: p.badge_id,
            workspaceMin: d.workspace_minutes,
            breakMin: d.break_minutes,
          }
        : null;
    })
    .filter((m): m is TeamMember => m !== null)
    .sort((a, b) => b.workspaceMin - a.workspaceMin);

  const longestRow = [...dwell].sort(
    (a, b) => b.continuous_workspace_minutes - a.continuous_workspace_minutes,
  )[0];
  const longest = longestRow
    ? {
        name: byId.get(longestRow.user_id)?.name ?? "—",
        minutes: longestRow.continuous_workspace_minutes,
        compliant: longestRow.osh_compliance_flag,
      }
    : null;
  const flaggedCount = dwell.filter(
    (d) =>
      !d.osh_compliance_flag ||
      d.continuous_workspace_minutes > APP_CONFIG.oshSittingThresholdMinutes,
  ).length;

  const handleExport = async () => {
    playClick();
    setExporting(true);
    try {
      const res = await exportCsv({ data: { date } });
      downloadText(res.filename, res.csv, "text/csv");
      toast.success(`Exported ${res.rows} boundary crossings`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card animate-fade-in p-6">
        <h2 className="text-xl font-semibold text-umbra">Workforce concourse & analytics</h2>
        <p className="text-sm text-sage">
          HR Operations Console — {profile?.name} ({profile?.badge_id})
        </p>
      </div>

      <ZoneOccupancyGrid
        workspaceCount={workspaceCount}
        commonCount={commonCount}
        enrolled={people.length}
        peakIngress={peak}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ZONES.map((z) => {
          const count = people.filter(
            (p) => detectedToday.has(p.id) && p.current_zone === z,
          ).length;
          const pct = people.length ? (count / people.length) * 100 : 0;
          return (
            <div key={z} className="stat-card">
              <div className="flex items-center justify-between">
                <span className="stat-card-label">{ZONE_LABELS[z]}</span>
                <span className="text-xs text-sage">{pct.toFixed(1)}%</span>
              </div>
              <div className="stat-card-value">{count}</div>
              <div className="mt-2 timeline-rail h-1.5">
                <div className="h-full bg-success" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card">
        <h3 className="mb-3 text-sm font-semibold text-umbra">Team presence Gantt — today</h3>
        <TeamPresenceGantt members={members} />
      </div>

      <WorkforceAttendanceTable people={people} dwellList={dwell} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OshComplianceCard longest={longest} />
        <div className="glass-card">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-strong">
            <AlertTriangle className="h-5 w-5" />
            OSH Code — alert summary
          </div>
          <p className="text-xs text-sage">
            {flaggedCount} employee{flaggedCount === 1 ? "" : "s"} flagged for extended sitting
            (&gt;4.5h continuous). Recommend ergonomic breaks at 11:00 and 15:00.
          </p>
        </div>
      </div>

      <div className="glass-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="stat-card-label">RFC 4180 CSV export</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              max={todayIST()}
              onChange={(e) => setDate(e.target.value)}
              className="glass-input py-2 text-xs"
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !date}
              className="glass-btn"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Preparing…" : "Download presence records (CSV)"}
            </button>
          </div>
        </div>
        <p className="text-xs text-sage">
          Boundary crossing log for the selected day with names, badges, cosine scores and vector
          hashes.
        </p>
      </div>
    </div>
  );
}
