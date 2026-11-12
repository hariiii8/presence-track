import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  Coffee,
  CheckCircle,
} from "lucide-react";
import { getMonthlyAttendanceSummary } from "@/lib/attendance.functions";
import { formatMinutes, todayIST, type AttendanceStatus } from "@/lib/ambient";

interface MonthlyAttendanceCalendarProps {
  employeeId: string;
}

export function MonthlyAttendanceCalendar({ employeeId }: MonthlyAttendanceCalendarProps) {
  const getSummaryFn = useServerFn(getMonthlyAttendanceSummary);
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  const [selectedDay, setSelectedDay] = useState<string | null>(todayIST());

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "monthly", employeeId, selectedMonth],
    queryFn: () =>
      getSummaryFn({
        data: {
          employee_id: employeeId,
          year_month: selectedMonth,
        },
      }),
    staleTime: 30_000,
  });

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const date = new Date(y!, m! - 1 + delta, 1);
    const newMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    setSelectedMonth(newMonth);
  };

  const records = data?.records ?? [];
  const recordMap = new Map(records.map((r) => [r.attendance_date, r]));

  // Calendar matrix calculation
  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year!, month!, 0).getDate();
  const firstDayOfWeek = new Date(year!, month! - 1, 1).getDay(); // 0 is Sunday

  const days: { dateStr: string; dayNum: number }[] = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const dStr = `${selectedMonth}-${String(i).padStart(2, "0")}`;
    days.push({ dateStr: dStr, dayNum: i });
  }

  const selectedRecord = selectedDay ? recordMap.get(selectedDay) : null;

  const getStatusBadge = (status?: AttendanceStatus | string, missedExit?: boolean) => {
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
        return <span className="pill bg-muted text-xxs font-semibold text-sage">ON LEAVE</span>;
      case "ABSENT":
        return (
          <span className="pill bg-destructive-soft text-xxs font-semibold text-destructive">
            ABSENT
          </span>
        );
      default:
        return <span className="pill bg-muted/50 text-xxs text-sage">NO DATA</span>;
    }
  };

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year!, month! - 1, 1));

  return (
    <div className="glass-card space-y-5 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-success-strong" />
            <h3 className="text-base font-bold text-umbra">Monthly Attendance & Punch History</h3>
          </div>
          <p className="mt-1 text-xs text-sage">
            Verified boundary transit dwell accounting and statutory timesheets
          </p>
        </div>

        {/* Month Navigator */}
        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
            className="rounded-lg p-1.5 text-sage hover:bg-card hover:text-umbra transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-32 text-center font-mono text-xs font-semibold text-umbra">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label="Next month"
            className="rounded-lg p-1.5 text-sage hover:bg-card hover:text-umbra transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Monthly Statistics Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="stat-card p-3">
          <div className="text-xxs text-sage">Present Days</div>
          <div className="mt-1 font-mono text-base font-bold text-success-strong">
            {data?.summary?.present_days ?? 0}
          </div>
          <div className="text-xxxs text-sage">of {daysInMonth} days</div>
        </div>

        <div className="stat-card p-3">
          <div className="text-xxs text-sage">Total Work Time</div>
          <div className="mt-1 font-mono text-base font-bold text-umbra">
            {formatMinutes(data?.summary?.total_work_minutes ?? 0)}
          </div>
          <div className="text-xxxs text-sage">
            Avg{" "}
            {data?.summary?.present_days
              ? Math.round(
                  (data.summary.total_work_minutes / data.summary.present_days / 60) * 10,
                ) / 10
              : 0}
            h / day
          </div>
        </div>

        <div className="stat-card p-3">
          <div className="text-xxs text-sage">Total Breaks</div>
          <div className="mt-1 font-mono text-base font-bold text-warning-strong">
            {formatMinutes(data?.summary?.total_break_minutes ?? 0)}
          </div>
          <div className="text-xxxs text-sage">Lounge & cafeteria</div>
        </div>

        <div className="stat-card p-3">
          <div className="text-xxs text-sage">Half Days</div>
          <div className="mt-1 font-mono text-base font-bold text-amber-500">
            {data?.summary?.half_days ?? 0}
          </div>
          <div className="text-xxxs text-sage">&lt; 4 hours desk time</div>
        </div>

        <div className="stat-card p-3">
          <div className="text-xxs text-sage">Missed Exits</div>
          <div className="mt-1 font-mono text-base font-bold text-destructive">
            {data?.summary?.missed_exits ?? 0}
          </div>
          <div className="text-xxxs text-sage">Unclosed day transits</div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="space-y-2">
        <div className="grid grid-cols-7 gap-1 text-center font-mono text-xxs font-medium text-sage">
          <div>SUN</div>
          <div>MON</div>
          <div>TUE</div>
          <div>WED</div>
          <div>THU</div>
          <div>FRI</div>
          <div>SAT</div>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-sage">
            Loading cryptographic attendance ledger…
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {/* Blank leading days */}
            {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
              <div key={`blank-${idx}`} className="h-16 rounded-xl bg-muted/10 opacity-30" />
            ))}

            {/* Month days */}
            {days.map(({ dateStr, dayNum }) => {
              const rec = recordMap.get(dateStr);
              const isSelected = selectedDay === dateStr;
              const isToday = dateStr === todayIST();
              const hasWork = (rec?.total_work_minutes ?? 0) > 0;

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDay(dateStr)}
                  className={`flex h-16 flex-col justify-between rounded-xl border p-2 text-left transition ${
                    isSelected
                      ? "border-success-strong bg-success-soft/30 shadow-sm"
                      : isToday
                        ? "border-primary/40 bg-card hover:border-border"
                        : "border-border/40 bg-card/60 hover:border-border hover:bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        isToday ? "text-success-strong" : "text-umbra"
                      }`}
                    >
                      {dayNum}
                    </span>
                    {rec?.missed_exit && (
                      <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                    )}
                  </div>

                  {rec ? (
                    <div className="space-y-0.5">
                      <div className="truncate font-mono text-xxs text-sage">
                        {hasWork ? formatMinutes(rec.total_work_minutes) : "0m"}
                      </div>
                      <div className="truncate">{getStatusBadge(rec.status, rec.missed_exit)}</div>
                    </div>
                  ) : (
                    <div className="text-xxxs text-muted-foreground/60">No transit</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Day Inspector */}
      {selectedDay && (
        <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <span className="stat-card-label">Detailed Record Inspection</span>
              <div className="font-mono text-sm font-bold text-umbra">{selectedDay}</div>
            </div>
            <div>
              {selectedRecord ? (
                getStatusBadge(selectedRecord.status, selectedRecord.missed_exit)
              ) : (
                <span className="pill bg-muted text-xxs text-sage">NO ENTRY RECORDED</span>
              )}
            </div>
          </div>

          {selectedRecord ? (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-card/70 p-2.5">
                <div className="text-xxs text-sage flex items-center gap-1">
                  <Clock className="h-3 w-3" /> First In
                </div>
                <div className="mt-1 font-mono font-semibold text-umbra">
                  {selectedRecord.first_in
                    ? new Date(selectedRecord.first_in).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })
                    : "—"}
                </div>
              </div>

              <div className="rounded-lg bg-card/70 p-2.5">
                <div className="text-xxs text-sage flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Last Out
                </div>
                <div className="mt-1 font-mono font-semibold text-umbra">
                  {selectedRecord.last_out
                    ? new Date(selectedRecord.last_out).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })
                    : selectedRecord.missed_exit
                      ? "Unclosed Exit"
                      : "—"}
                </div>
              </div>

              <div className="rounded-lg bg-card/70 p-2.5">
                <div className="text-xxs text-sage flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-success" /> Work Duration
                </div>
                <div className="mt-1 font-mono font-semibold text-success-strong">
                  {formatMinutes(selectedRecord.total_work_minutes)}
                </div>
              </div>

              <div className="rounded-lg bg-card/70 p-2.5">
                <div className="text-xxs text-sage flex items-center gap-1">
                  <Coffee className="h-3 w-3 text-warning" /> Break Duration
                </div>
                <div className="mt-1 font-mono font-semibold text-warning-strong">
                  {selectedRecord.total_break_minutes} min
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-sage">
              No boundary crossings or manual check-ins recorded on this calendar day.
            </p>
          )}

          {selectedRecord?.missed_exit && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning-strong/30 bg-warning-soft/40 p-2 text-xxs text-warning-strong">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Missed exit detected: The system recorded an entry without a corresponding exit
                transit before the calendar day concluded.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
