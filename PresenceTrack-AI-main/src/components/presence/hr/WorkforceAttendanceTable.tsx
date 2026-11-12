import { useState } from "react";
import { Search, Filter, Eye, Users, Building, Clock, CheckCircle } from "lucide-react";
import {
  formatMinutes,
  ZONE_LABELS,
  type EnterpriseUser,
  type EmployeeDailyDwell,
} from "@/lib/ambient";
import { EmployeeAttendanceDetailModal } from "./EmployeeAttendanceDetailModal";

interface WorkforceAttendanceTableProps {
  people: EnterpriseUser[];
  dwellList: EmployeeDailyDwell[];
}

export function WorkforceAttendanceTable({ people, dwellList }: WorkforceAttendanceTableProps) {
  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedEmployee, setSelectedEmployee] = useState<EnterpriseUser | null>(null);

  const dwellMap = new Map(dwellList.map((d) => [d.user_id, d]));

  // Get distinct departments
  const departments = Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort();

  const q = search.toLowerCase().trim();
  const filtered = people.filter((p) => {
    // Search match
    const matchSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      p.badge_id.toLowerCase().includes(q);

    // Department match
    const matchDept = selectedDept === "ALL" || p.department === selectedDept;

    // Status match
    const dwell = dwellMap.get(p.id);
    const hasWork = (dwell?.workspace_minutes ?? 0) > 0;
    const isPresent = Boolean(p.current_zone && p.current_zone !== "CORRIDOR_TRANSIT");

    let matchStatus = true;
    if (statusFilter === "PRESENT") matchStatus = isPresent;
    if (statusFilter === "ABSENT") matchStatus = !hasWork && !isPresent;
    if (statusFilter === "WORKED") matchStatus = hasWork;

    return matchSearch && matchDept && matchStatus;
  });

  return (
    <div className="glass-card space-y-4 p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-success-strong" />
            <h3 className="text-base font-bold text-umbra">
              Workforce Real-Time Attendance Ledger
            </h3>
          </div>
          <p className="mt-1 text-xs text-sage">
            Real-time concourse presence, working hours, and individual employee drilldowns
          </p>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sage" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, badge, email…"
              className="glass-input pl-8 py-1.5 text-xs w-48 sm:w-60"
            />
          </div>

          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="glass-input py-1.5 text-xs"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-input py-1.5 text-xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="PRESENT">Currently On-Site</option>
            <option value="WORKED">Active Today</option>
            <option value="ABSENT">No Attendance</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="table-glass text-xs">
          <thead>
            <tr>
              <th>Personnel</th>
              <th>Badge ID</th>
              <th>Department</th>
              <th>Current Zone</th>
              <th>Desk Time Today</th>
              <th>Breaks</th>
              <th>Status</th>
              <th>History</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sage">
                  No matching employees found.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const dwell = dwellMap.get(p.id);
                const workMinutes = dwell?.workspace_minutes ?? 0;
                const breakMinutes = dwell?.break_minutes ?? 0;
                const isInside = Boolean(p.current_zone && p.current_zone !== "CORRIDOR_TRANSIT");

                return (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <img
                          src={
                            p.avatar_url ??
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(
                              p.name,
                            )}&background=10B981&color=fff&bold=true`
                          }
                          alt={p.name}
                          className="h-7 w-7 rounded-full border border-border/50 object-cover"
                        />
                        <div>
                          <div className="font-semibold text-umbra">{p.name}</div>
                          <div className="text-xxs text-sage">{p.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-sage">{p.badge_id}</td>
                    <td className="text-sage">{p.department}</td>
                    <td>
                      {p.current_zone ? (
                        <span className="pill bg-success-soft text-xxs font-semibold text-success-strong">
                          {ZONE_LABELS[p.current_zone]}
                        </span>
                      ) : (
                        <span className="pill bg-muted/60 text-xxs text-sage">Off Premise</span>
                      )}
                    </td>
                    <td className="font-mono font-semibold text-umbra">
                      {workMinutes > 0 ? (
                        <span className="text-success-strong">{formatMinutes(workMinutes)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="font-mono text-warning-strong">
                      {breakMinutes > 0 ? `${breakMinutes}m` : "—"}
                    </td>
                    <td>
                      {isInside ? (
                        <span className="pill bg-success/20 text-xxs font-semibold text-success-strong flex items-center gap-1 w-fit">
                          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                          ON-SITE
                        </span>
                      ) : workMinutes > 0 ? (
                        <span className="pill bg-muted text-xxs font-medium text-sage">
                          COMPLETED
                        </span>
                      ) : (
                        <span className="pill bg-destructive-soft text-xxs font-medium text-destructive">
                          ABSENT
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedEmployee(p)}
                        className="glass-btn flex items-center gap-1 py-1 px-2.5 text-xxs"
                      >
                        <Eye className="h-3 w-3" />
                        Statements
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xxs text-sage pt-2">
        <span>
          Showing {filtered.length} of {people.length} personnel
        </span>
        <span>Telemetry synchronized via Supabase Realtime</span>
      </div>

      {selectedEmployee && (
        <EmployeeAttendanceDetailModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
}
