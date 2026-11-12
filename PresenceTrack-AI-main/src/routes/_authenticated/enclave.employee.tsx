import { createFileRoute, redirect, useRouteContext } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  APP_CONFIG,
  formatMinutes,
  todayIST,
  ZONE_LABELS,
  type EnterpriseUser,
} from "@/lib/ambient";
import { canAccessEnclave, enclavePathFor } from "@/lib/enclaves";
import { myDwellQuery, myErasureRequestsQuery, myTransitsQuery } from "@/lib/queries";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { DwellTimeGauge } from "@/components/presence/employee/DwellTimeGauge";
import { PersonalTimeline } from "@/components/presence/employee/PersonalTimeline";
import { PersonalTransitLog } from "@/components/presence/employee/PersonalTransitLog";
import { ConsentVault } from "@/components/presence/employee/ConsentVault";
import { ManualPunchCard } from "@/components/presence/employee/ManualPunchCard";
import { MonthlyAttendanceCalendar } from "@/components/presence/employee/MonthlyAttendanceCalendar";
import { UnlinkedProfile } from "@/components/presence/layout/UnlinkedProfile";
import { playTransitBlip } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/enclave/employee")({
  head: () => ({
    meta: [
      { title: "Employee Console — PresenceTrack AI" },
      {
        name: "description",
        content: "Your personal dwell time, boundary transits and DPDP data vault.",
      },
      { property: "og:title", content: "Employee Console — PresenceTrack AI" },
      {
        property: "og:description",
        content: "Your personal dwell time, boundary transits and DPDP data vault.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!canAccessEnclave(context.role, "employee"))
      throw redirect({ to: enclavePathFor(context.role) });
  },
  loader: async ({ context }) => {
    if (!context.profile) return;
    const id = context.profile.id;
    await Promise.all([
      context.queryClient.ensureQueryData(myDwellQuery(id)),
      context.queryClient.ensureQueryData(myTransitsQuery(id)),
      context.queryClient.ensureQueryData(myErasureRequestsQuery(id)),
    ]);
  },
  component: EmployeeEnclave,
});

function EmployeeEnclave() {
  const { profile } = useRouteContext({ from: "/_authenticated" });
  if (!profile) return <UnlinkedProfile />;
  return <EmployeeConsole profile={profile} />;
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function EmployeeConsole({ profile }: { profile: EnterpriseUser }) {
  const { data: dwell } = useSuspenseQuery(myDwellQuery(profile.id));
  const { data: transits } = useSuspenseQuery(myTransitsQuery(profile.id));
  const { data: requests } = useSuspenseQuery(myErasureRequestsQuery(profile.id));

  useRealtimeRefresh(
    "passive_transits",
    [
      ["transits", "me"],
      ["dwell", "me"],
    ],
    {
      filter: `user_id=eq.${profile.id}`,
      onInsert: playTransitBlip,
    },
  );

  const today = todayIST();
  const todays = transits.filter(
    (t) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(t.timestamp),
      ) === today,
  );
  const workspace = dwell?.workspace_minutes ?? 0;
  const breaks = dwell?.break_minutes ?? 0;
  const breakSessions = todays.filter(
    (t) => t.zone_to === "CAFETERIA_LOUNGE" || t.zone_to === "OUTDOOR_TERRACE",
  ).length;
  const latest = transits[0];
  const inside = profile.current_zone === "WORKSPACE_FLOOR";

  return (
    <div className="space-y-6">
      <div className="glass-card animate-fade-in p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-umbra">
              {greeting()}, {profile.name.split(" ")[0]}.
            </h2>
            <p className="text-sm text-sage">
              {profile.role_title} · {profile.department} ·{" "}
              {profile.consent_revoked
                ? "Boundary telemetry paused (consent revoked)."
                : "Your ESP32-CAM boundary telemetry is active."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success-soft px-3 py-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  inside ? "animate-pulse bg-success" : "bg-warning",
                )}
              />
              <span className="text-xs font-semibold text-success-strong">LIVE</span>
              <span className="text-xs text-sage">|</span>
              <span className="text-xs text-sage">
                {profile.current_zone
                  ? ZONE_LABELS[profile.current_zone].toUpperCase()
                  : "NOT DETECTED"}
              </span>
            </div>
            <ConsentVault profile={profile} requests={requests} />
          </div>
        </div>
      </div>

      <ManualPunchCard profile={profile} />

      <DwellTimeGauge
        workspaceMinutes={workspace}
        breakMinutes={breaks}
        workspaceTargetMinutes={APP_CONFIG.workspaceTargetMinutes}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="stat-card-label">Productive desk time</div>
          <div className="stat-card-value font-mono text-success-strong">
            {formatMinutes(workspace)}
          </div>
          <div className="mt-1 text-xs text-sage">
            vs 8h target {workspace >= APP_CONFIG.workspaceTargetMinutes ? "✓" : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Wellness / break time</div>
          <div className="stat-card-value font-mono text-warning-strong">{breaks}m</div>
          <div className="mt-1 text-xs text-sage">
            {breakSessions} session{breakSessions === 1 ? "" : "s"} today
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Biometric cosine score (Sc)</div>
          <div className="stat-card-value font-mono text-success-strong">
            {latest ? Number(latest.cosine_score).toFixed(4) : "—"}
          </div>
          <div className="mt-1 text-xs text-sage">
            Sc ≥ {APP_CONFIG.cosineThreshold.toFixed(4)} required
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Vault state</div>
          <div
            className={cn(
              "stat-card-value font-mono",
              profile.consent_revoked ? "text-warning-strong" : "text-success-strong",
            )}
          >
            {profile.consent_revoked ? "REVOKED" : "SEALED ✓"}
          </div>
          <div className="mt-1 text-xs text-sage">
            Memory scrub: {latest ? `${latest.dram_scrub_ms}ms` : "—"} (target &lt;{" "}
            {APP_CONFIG.dramTargetMs}ms)
          </div>
        </div>
      </div>

      <div className="glass-card">
        <h3 className="mb-3 text-sm font-semibold text-umbra">Working-hours horizon</h3>
        <PersonalTimeline transits={todays} oshCompliant={dwell?.osh_compliance_flag ?? true} />
      </div>

      <MonthlyAttendanceCalendar employeeId={profile.id} />

      <div className="glass-card">
        <h3 className="mb-3 text-sm font-semibold text-umbra">
          Verifiable boundary transit ledger
        </h3>
        <PersonalTransitLog transits={transits} />
      </div>
    </div>
  );
}
