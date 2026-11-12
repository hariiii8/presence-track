import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Calendar, Clock, Coffee, AlertTriangle, UserCheck } from "lucide-react";
import { Modal } from "@/components/presence/layout/Modal";
import { getMonthlyAttendanceSummary } from "@/lib/attendance.functions";
import { formatMinutes, type EnterpriseUser, type AttendanceStatus } from "@/lib/ambient";

interface EmployeeAttendanceDetailModalProps {
  employee: EnterpriseUser;
  onClose: () => void;
}

export function EmployeeAttendanceDetailModal({
  employee,
  onClose,
}: EmployeeAttendanceDetailModalProps) {
  const getSummaryFn = useServerFn(getMonthlyAttendanceSummary);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "hr-detail", employee.id, selectedMonth],
    queryFn: () =>
      getSummaryFn({
        data: {
          employee_id: employee.id,
          year_month: selectedMonth,
        },
      }),
    staleTime: 30_000,
  });

  const records = data?.records ?? [];

  const getStatusBadge = (status: AttendanceStatus, missedExit: boolean) => {
    if (missedExit) {
      return (
        <span className="pill bg-warning-soft text-xxs font-semibold text-warning-strong">
          MISSED EXIT
        </span>
      );
    }
    switch (status) {
      case "PRESENT":
        return (
          <span className="pill bg-success-soft text-xxs font-semibold text-success-strong">
            PRESENT
          </span>
        );
      case "HALF_DAY":
        return (
          <span className="pill bg-amber-500/10 text-xxs font-semibold text-amber-500">
            HALF DAY
          </span>
        );
      case "ON_LEAVE":
        return <span className="pill bg-muted text-xxs text-sage">ON LEAVE</span>;
      case "ABSENT":
        return (
          <span className="pill bg-destructive-soft text-xxs font-semibold text-destructive">
            ABSENT
          </span>
        );
      default:
        return <span className="pill bg-muted/40 text-xxs text-sage">{status}</span>;
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="employee-detail-title">
      <div className="p-6">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-3">
            <img
              src={
                employee.avatar_url ??
                `https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name)}`
              }
              alt={employee.name}
              className="h-10 w-10 rounded-full border border-border/50 object-cover"
            />
            <div>
              <h2 id="employee-detail-title" className="text-base font-bold text-umbra">
                {employee.name}
              </h2>
              <p className="text-xxs text-sage">
                {employee.badge_id} · {employee.department} · {employee.role_title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-sage hover:bg-muted hover:text-umbra"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Month Selector & Quick Summary */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-sage">Statement Month:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="glass-input py-1 text-xs"
            />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-sage">
              Present:{" "}
              <strong className="text-success-strong font-mono">
                {data?.summary?.present_days ?? 0}
              </strong>{" "}
              days
            </span>
            <span className="text-sage">
              Total:{" "}
              <strong className="text-umbra font-mono">
                {formatMinutes(data?.summary?.total_work_minutes ?? 0)}
              </strong>
            </span>
            <span className="text-sage">
              Breaks:{" "}
              <strong className="text-warning-strong font-mono">
                {formatMinutes(data?.summary?.total_break_minutes ?? 0)}
              </strong>
            </span>
          </div>
        </div>

        {/* Table of Daily Records */}
        <div className="mt-4 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-sage">Loading monthly records…</div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center text-xs text-sage">
              No presence records for this month.
            </div>
          ) : (
            <table className="table-glass text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>First In</th>
                  <th>Last Out</th>
                  <th>Work Time</th>
                  <th>Break Time</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-medium text-umbra">{r.attendance_date}</td>
                    <td>{getStatusBadge(r.status, r.missed_exit)}</td>
                    <td className="font-mono text-sage">
                      {r.first_in
                        ? new Date(r.first_in).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Kolkata",
                          })
                        : "—"}
                    </td>
                    <td className="font-mono text-sage">
                      {r.last_out
                        ? new Date(r.last_out).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Kolkata",
                          })
                        : r.missed_exit
                          ? "Open Entry"
                          : "—"}
                    </td>
                    <td className="font-mono font-semibold text-success-strong">
                      {formatMinutes(r.total_work_minutes)}
                    </td>
                    <td className="font-mono text-warning-strong">{r.total_break_minutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="glass-btn py-1.5 text-xs">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
