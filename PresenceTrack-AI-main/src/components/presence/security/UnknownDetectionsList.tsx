import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck, Filter, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { getUnknownDetections, resolveUnknownDetection } from "@/lib/audit.functions";
import { ZONE_LABELS, type UnknownDetection, type ZoneType } from "@/lib/ambient";

export function UnknownDetectionsList() {
  const queryClient = useQueryClient();
  const getAlertsFn = useServerFn(getUnknownDetections);
  const resolveFn = useServerFn(resolveUnknownDetection);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["unknown_detections", statusFilter],
    queryFn: () =>
      getAlertsFn({
        data: {
          status: statusFilter === "ALL" ? undefined : statusFilter,
          limit: 30,
        },
      }),
    refetchInterval: 10_000,
  });

  const alerts = (data?.detections ?? []) as UnknownDetection[];

  const handleResolve = async (id: string, status: "RESOLVED" | "FALSE_POSITIVE" | "ESCALATED") => {
    setResolvingId(id);
    try {
      const res = await resolveFn({
        data: {
          id,
          status,
          notes: `Reviewed by physical security officer (${status})`,
        },
      });

      if (res.success) {
        toast.success(`Alert marked as ${status}`);
        await refetch();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update alert");
    } finally {
      setResolvingId(null);
    }
  };

  const getStatusPill = (status: string) => {
    switch (status) {
      case "PENDING":
        return (
          <span className="pill bg-destructive-soft text-xxs font-semibold text-destructive flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
            PENDING TRIAGE
          </span>
        );
      case "RESOLVED":
        return (
          <span className="pill bg-success-soft text-xxs font-semibold text-success-strong">
            RESOLVED
          </span>
        );
      case "FALSE_POSITIVE":
        return <span className="pill bg-muted text-xxs text-sage">FALSE POSITIVE</span>;
      case "ESCALATED":
        return (
          <span className="pill bg-warning-soft text-xxs font-semibold text-warning-strong">
            ESCALATED
          </span>
        );
      default:
        return <span className="pill bg-muted text-xxs text-sage">{status}</span>;
    }
  };

  return (
    <div className="glass-card space-y-4 p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning-strong" />
            <h3 className="text-base font-bold text-umbra">Unknown Face Detection Alerts</h3>
          </div>
          <p className="mt-1 text-xs text-sage">
            Real-time optical alerts for unrecognized boundary entries or low cosine threshold
            scores
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-input py-1.5 text-xs"
          >
            <option value="ALL">All Alerts</option>
            <option value="PENDING">Pending Review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="FALSE_POSITIVE">False Positive</option>
            <option value="ESCALATED">Escalated</option>
          </select>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="glass-btn p-2 text-xs"
            title="Refresh Alert Feed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-glass text-xs">
          <thead>
            <tr>
              <th>Timestamp (IST)</th>
              <th>Camera / Node ID</th>
              <th>Boundary Zone</th>
              <th>Cosine Confidence</th>
              <th>Triage Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sage">
                  Querying security detection feed…
                </td>
              </tr>
            ) : alerts.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sage">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <ShieldCheck className="h-6 w-6 text-success-strong" />
                    <span className="font-medium text-umbra">No active unknown-face alerts.</span>
                    <span className="text-xxs text-sage">
                      Perimeter boundary is clear. Real-time edge detections will appear here
                      automatically.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="font-mono text-sage whitespace-nowrap">
                    {new Date(alert.detected_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="font-mono text-xs text-umbra font-medium">{alert.device_id}</td>
                  <td className="text-sage">
                    {alert.zone_id && ZONE_LABELS[alert.zone_id as ZoneType]
                      ? ZONE_LABELS[alert.zone_id as ZoneType]
                      : alert.zone_id || "Perimeter"}
                  </td>
                  <td className="font-mono text-xs font-semibold text-warning-strong">
                    Sc {alert.detection_confidence ? alert.detection_confidence.toFixed(4) : "—"}
                  </td>
                  <td>{getStatusPill(alert.reviewed_status)}</td>
                  <td>
                    {alert.reviewed_status === "PENDING" ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={resolvingId === alert.id}
                          onClick={() => handleResolve(alert.id, "RESOLVED")}
                          className="glass-btn border-success/40 bg-success-soft text-success-strong py-0.5 px-2 text-xxs font-semibold"
                        >
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId === alert.id}
                          onClick={() => handleResolve(alert.id, "FALSE_POSITIVE")}
                          className="glass-btn py-0.5 px-2 text-xxs"
                        >
                          False Alert
                        </button>
                      </div>
                    ) : (
                      <span className="text-xxs text-sage">Reviewed</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xxs text-sage pt-1">
        <span>Displaying latest edge boundary alerts</span>
        <span>DPDP Compliant: Biometric templates never stored for unverified individuals</span>
      </div>
    </div>
  );
}
