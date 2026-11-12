interface ZoneOccupancyProps {
  workspaceCount: number;
  commonCount: number;
  enrolled: number;
  peakIngress: { count: number; hour: number | null };
}

/** Headcount split: workspace floors vs. cafeterias/lounges. */
export function ZoneOccupancyGrid({
  workspaceCount,
  commonCount,
  enrolled,
  peakIngress,
}: ZoneOccupancyProps) {
  const onSite = workspaceCount + commonCount;
  const cards = [
    {
      label: "On-site presence",
      value: String(onSite),
      sub: `${enrolled} enrolled · ${enrolled ? ((onSite / enrolled) * 100).toFixed(1) : "0.0"}%`,
      dot: "bg-success",
    },
    {
      label: "Active in workspace",
      value: String(workspaceCount),
      sub: "personnel",
      dot: "bg-success",
    },
    {
      label: "In cafeterias & lounges",
      value: String(commonCount),
      sub: "personnel",
      dot: "bg-warning",
    },
    {
      label: "Peak ingress rate",
      value: String(peakIngress.count),
      sub:
        peakIngress.hour === null
          ? "no entries yet today"
          : `transits/hr (${String(peakIngress.hour).padStart(2, "0")}:00 IST)`,
      dot: "bg-penna",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className="stat-card animate-fade-in"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="flex items-center justify-between">
            <span className="stat-card-label">{card.label}</span>
            <span className={`h-2 w-2 rounded-full ${card.dot}`} />
          </div>
          <div className="stat-card-value">{card.value}</div>
          <div className="mt-1 truncate text-xs text-sage">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}
