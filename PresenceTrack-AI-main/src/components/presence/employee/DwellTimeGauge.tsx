interface DwellTimeGaugeProps {
  workspaceMinutes: number;
  breakMinutes: number;
  workspaceTargetMinutes: number;
}

/** Horizontal split gauge: workspace dwell vs. common-area dwell. */
export function DwellTimeGauge({
  workspaceMinutes,
  breakMinutes,
  workspaceTargetMinutes,
}: DwellTimeGaugeProps) {
  const total = workspaceMinutes + breakMinutes;
  const workspacePct = total > 0 ? (workspaceMinutes / total) * 100 : 0;
  const breakPct = total > 0 ? (breakMinutes / total) * 100 : 0;
  const targetPct = Math.min((workspaceMinutes / workspaceTargetMinutes) * 100, 100);

  return (
    <div className="glass-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-card-label">Dwell time distribution</span>
        <span className="text-xs text-sage">
          {Math.round(targetPct)}% of {workspaceTargetMinutes / 60}h workspace target
        </span>
      </div>
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-gradient-to-r from-success-strong to-success transition-all duration-700"
          style={{ width: `${workspacePct}%` }}
          title={`Workspace: ${workspaceMinutes}m`}
        />
        <div
          className="bg-gradient-to-r from-warning-strong to-warning transition-all duration-700"
          style={{ width: `${breakPct}%` }}
          title={`Break: ${breakMinutes}m`}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="flex items-center gap-1.5 text-success-strong">
          <span className="h-2 w-2 rounded-full bg-success" /> Workspace · {workspaceMinutes}m
        </span>
        <span className="flex items-center gap-1.5 text-warning-strong">
          <span className="h-2 w-2 rounded-full bg-warning" /> Common area · {breakMinutes}m
        </span>
      </div>
      {total === 0 && (
        <p className="mt-3 text-xs text-sage">No boundary crossings recorded yet today.</p>
      )}
    </div>
  );
}
