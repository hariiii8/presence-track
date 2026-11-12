import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, RefreshCw, Filter, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { getAdminAuditLogs } from "@/lib/audit.functions";
import type { AdminAuditLog } from "@/lib/ambient";

export function AuditLogViewer() {
  const getLogsFn = useServerFn(getAdminAuditLogs);
  const [limit, setLimit] = useState(50);
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<AdminAuditLog | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin_audit_logs", limit, entityFilter],
    queryFn: () =>
      getLogsFn({
        data: {
          limit,
          entity_type: entityFilter === "ALL" ? undefined : entityFilter,
        },
      }),
    refetchInterval: 15_000,
  });

  const logs = (data?.logs ?? []) as AdminAuditLog[];

  const q = search.toLowerCase().trim();
  const filtered = logs.filter((l) => {
    if (!q) return true;
    return (
      l.action.toLowerCase().includes(q) ||
      l.entity_type.toLowerCase().includes(q) ||
      l.actor_id?.toLowerCase().includes(q) ||
      l.entity_id?.toLowerCase().includes(q) ||
      JSON.stringify(l.metadata).toLowerCase().includes(q)
    );
  });

  const getActionBadge = (action: string) => {
    if (action.startsWith("auth.login_failed") || action.includes("DEACTIVATE")) {
      return (
        <span className="pill bg-destructive-soft text-xxs font-mono font-semibold text-destructive">
          {action}
        </span>
      );
    }
    if (
      action.startsWith("auth.login_success") ||
      action.includes("INVITE") ||
      action.includes("ACTIVATE")
    ) {
      return (
        <span className="pill bg-success-soft text-xxs font-mono font-semibold text-success-strong">
          {action}
        </span>
      );
    }
    if (action.includes("ASSIGN_ROLE") || action.includes("UPDATE")) {
      return (
        <span className="pill bg-amber-500/10 text-xxs font-mono font-semibold text-amber-500">
          {action}
        </span>
      );
    }
    return <span className="pill bg-muted/70 text-xxs font-mono text-sage">{action}</span>;
  };

  return (
    <div className="glass-card space-y-4 p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-success-strong" />
            <h3 className="text-base font-bold text-umbra">
              Security & Administrative Audit Trail
            </h3>
          </div>
          <p className="mt-1 text-xs text-sage">
            Immutable, tamper-evident log of authentication, credential changes, and enclave
            modifications
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter actions or IDs…"
            className="glass-input py-1.5 text-xs w-44 sm:w-52"
          />

          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="glass-input py-1.5 text-xs"
          >
            <option value="ALL">All Entities</option>
            <option value="auth">Authentication</option>
            <option value="enterprise_users">Personnel</option>
            <option value="departments">Departments</option>
            <option value="user_roles">User Roles</option>
            <option value="devices">Edge Hardware</option>
          </select>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="glass-btn p-2 text-xs"
            title="Refresh Audit Trail"
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
              <th>Action</th>
              <th>Entity</th>
              <th>Actor ID</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sage">
                  Loading immutable audit events…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sage">
                  No matching audit records.
                </td>
              </tr>
            ) : (
              filtered.map((log) => (
                <tr key={log.id}>
                  <td className="font-mono text-sage whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("en-GB", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </td>
                  <td>{getActionBadge(log.action)}</td>
                  <td className="font-mono text-xs text-umbra">{log.entity_type}</td>
                  <td className="font-mono text-xxs text-sage">
                    {log.actor_id ? log.actor_id.slice(0, 8) + "…" : "System / Unauth"}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedLog(log)}
                      className="glass-btn flex items-center gap-1 py-1 px-2 text-xxs"
                    >
                      <Eye className="h-3 w-3" /> Inspect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xxs text-sage pt-2">
        <span>Showing {filtered.length} recent audit logs</span>
        <div className="flex items-center gap-2">
          <span>Limit:</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="glass-input py-0.5 text-xxs"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Audit Log Detail Inspector Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="glass-card max-w-lg w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h4 className="text-sm font-bold text-umbra">Audit Event Details</h4>
                <div className="font-mono text-xxs text-sage">{selectedLog.id}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-sage hover:text-umbra"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-sage">Action:</span>
                <span className="font-mono font-bold text-umbra">{selectedLog.action}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sage">Entity Type:</span>
                <span className="font-mono text-umbra">{selectedLog.entity_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sage">Entity ID:</span>
                <span className="font-mono text-umbra">{selectedLog.entity_id ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sage">Actor ID:</span>
                <span className="font-mono text-umbra">{selectedLog.actor_id ?? "System"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sage">Timestamp:</span>
                <span className="font-mono text-umbra">
                  {new Date(selectedLog.created_at).toISOString()}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xxs font-semibold text-sage mb-1">Sanitized Metadata:</div>
              <pre className="max-h-48 overflow-auto rounded-lg bg-stage p-3 font-mono text-xxs text-emerald-400">
                {JSON.stringify(selectedLog.metadata, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="glass-btn py-1.5 px-3 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
