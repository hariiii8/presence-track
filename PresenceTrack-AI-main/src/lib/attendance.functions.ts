import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sha256Hex } from "@/lib/merkle";
import {
  todayIST,
  type AttendanceRecord,
  type EmployeeDailyDwell,
  type EnterpriseUser,
} from "@/lib/ambient";
import type { Database } from "@/integrations/supabase/types";

/**
 * Attendance calculation & session utilities (server-side).
 */

/** Helper: resolve caller's enterprise profile ID */
async function getCallerEnterpriseProfile(supabase: SupabaseClient<Database>, authUserId: string) {
  const { data: profile } = await supabase
    .from("enterprise_users")
    .select("id, name, badge_id, consent_revoked, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return profile;
}

/** Helper: verify caller is HR, Admin or self */
async function canAccessEmployeeAttendance(
  supabase: SupabaseClient<Database>,
  authUserId: string,
  targetEmployeeId: string,
) {
  const { data: hasStaffRole } = await supabase.rpc("has_any_role", {
    _user_id: authUserId,
    _roles: ["hr_ops", "super_admin"],
  });
  if (hasStaffRole) return true;

  const profile = await getCallerEnterpriseProfile(supabase, authUserId);
  return profile?.id === targetEmployeeId;
}

// ── Attendance Server Functions ─────────────────────────────────────────────

/** Retrieve today's attendance metrics and session status. */
export const getTodayAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        employee_id: z.string().uuid().optional(),
        department_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const today = todayIST();

    // If querying specific employee, verify authorization
    if (data.employee_id) {
      const allowed = await canAccessEmployeeAttendance(
        context.supabase,
        context.userId,
        data.employee_id,
      );
      if (!allowed) throw new Error("Unauthorized to view this attendance record");

      // Attempt to load from attendance_records
      const { data: rec } = await context.supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", data.employee_id)
        .eq("attendance_date", today)
        .maybeSingle();

      // Also get dwell tracking data
      const { data: dwell } = await context.supabase
        .from("employee_daily_dwell")
        .select("*")
        .eq("user_id", data.employee_id)
        .eq("record_date", today)
        .maybeSingle();

      return {
        success: true,
        record: rec ?? {
          employee_id: data.employee_id,
          attendance_date: today,
          first_in: null,
          last_out: null,
          total_work_minutes: dwell?.workspace_minutes ?? 0,
          total_break_minutes: dwell?.break_minutes ?? 0,
          status: (dwell?.workspace_minutes ?? 0) > 0 ? "PRESENT" : "ABSENT",
          missed_exit: false,
        },
        dwell: dwell ?? null,
      };
    }

    // Otherwise, HR / Admin overview for today across active staff
    const { data: isStaff } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["hr_ops", "super_admin"],
    });
    if (!isStaff) {
      // Regular employee caller without employee_id: default to self
      const callerProfile = await getCallerEnterpriseProfile(context.supabase, context.userId);
      if (!callerProfile) throw new Error("No employee profile found for account");

      const { data: rec } = await context.supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", callerProfile.id)
        .eq("attendance_date", today)
        .maybeSingle();

      return { success: true, record: rec ?? null };
    }

    // Staff overview: fetch active people and today's attendance
    const query = context.supabase
      .from("enterprise_users")
      .select("id, name, badge_id, department, current_zone, is_in_workspace")
      .order("name", { ascending: true });

    const [{ data: people, error: pErr }, { data: records, error: rErr }, { data: dwellList }] =
      await Promise.all([
        query,
        context.supabase.from("attendance_records").select("*").eq("attendance_date", today),
        context.supabase.from("employee_daily_dwell").select("*").eq("record_date", today),
      ]);

    if (pErr) throw new Error("Failed to load staff list");

    const recordMap = new Map((records ?? []).map((r: AttendanceRecord) => [r.employee_id, r]));
    const dwellMap = new Map((dwellList ?? []).map((d: EmployeeDailyDwell) => [d.user_id, d]));

    const summary = (people ?? []).map(
      (
        p: Pick<
          EnterpriseUser,
          "id" | "name" | "badge_id" | "department" | "current_zone" | "is_in_workspace"
        >,
      ) => {
        const rec = recordMap.get(p.id);
        const dwell = dwellMap.get(p.id);
        const workMin = rec?.total_work_minutes ?? dwell?.workspace_minutes ?? 0;
        const breakMin = rec?.total_break_minutes ?? dwell?.break_minutes ?? 0;
        const isPresent = workMin > 0 || p.current_zone === "WORKSPACE_FLOOR";

        return {
          employee_id: p.id,
          name: p.name,
          badge_id: p.badge_id,
          department: p.department,
          current_zone: p.current_zone,
          is_in_workspace: p.is_in_workspace,
          first_in: rec?.first_in ?? null,
          last_out: rec?.last_out ?? null,
          total_work_minutes: workMin,
          total_break_minutes: breakMin,
          status: rec?.status ?? (isPresent ? "PRESENT" : "ABSENT"),
          missed_exit: rec?.missed_exit ?? false,
        };
      },
    );

    const presentCount = summary.filter(
      (s) => s.status === "PRESENT" || s.status === "HALF_DAY",
    ).length;
    const absentCount = summary.length - presentCount;

    return {
      success: true,
      total_enrolled: summary.length,
      present_count: presentCount,
      absent_count: absentCount,
      attendance: summary,
    };
  });

/** Retrieve employee attendance history between date bounds. */
export const getEmployeeAttendanceHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        employee_id: z.string().uuid(),
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const allowed = await canAccessEmployeeAttendance(
      context.supabase,
      context.userId,
      data.employee_id,
    );
    if (!allowed) throw new Error("Unauthorized to view this attendance history");

    const { data: records, error } = await context.supabase
      .from("attendance_records")
      .select("*")
      .eq("employee_id", data.employee_id)
      .gte("attendance_date", data.from_date)
      .lte("attendance_date", data.to_date)
      .order("attendance_date", { ascending: false });

    if (error) throw new Error("Failed to load attendance history");

    return { success: true, history: records ?? [] };
  });

/** Retrieve monthly attendance summary and statistics. */
export const getMonthlyAttendanceSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        employee_id: z.string().uuid(),
        year_month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const allowed = await canAccessEmployeeAttendance(
      context.supabase,
      context.userId,
      data.employee_id,
    );
    if (!allowed) throw new Error("Unauthorized to view this attendance summary");

    const [yearStr, monthStr] = data.year_month.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const startDate = `${data.year_month}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${data.year_month}-${String(lastDay).padStart(2, "0")}`;

    const { data: records, error } = await context.supabase
      .from("attendance_records")
      .select("*")
      .eq("employee_id", data.employee_id)
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)
      .order("attendance_date", { ascending: true });

    if (error) throw new Error("Failed to load monthly attendance");

    const items = records ?? [];
    let presentDays = 0;
    let halfDays = 0;
    let totalWorkMin = 0;
    let totalBreakMin = 0;
    let missedExits = 0;

    for (const r of items) {
      if (r.status === "PRESENT") presentDays++;
      else if (r.status === "HALF_DAY") halfDays++;
      totalWorkMin += r.total_work_minutes;
      totalBreakMin += r.total_break_minutes;
      if (r.missed_exit) missedExits++;
    }

    return {
      success: true,
      month: data.year_month,
      days_in_month: lastDay,
      present_days: presentDays,
      half_days: halfDays,
      total_work_minutes: totalWorkMin,
      total_break_minutes: totalBreakMin,
      missed_exits: missedExits,
      records: items,
    };
  });

/** Non-biometric manual check-in / check-out fallback. */
export const manualCheckInFallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        direction: z.enum(["ZONE_ENTER", "ZONE_EXIT"]),
        notes: z.string().trim().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const profile = await getCallerEnterpriseProfile(context.supabase, context.userId);
    if (!profile) throw new Error("No enterprise profile found for this account");

    const now = new Date();
    const isoTime = now.toISOString();
    const today = todayIST(now);
    const zoneFrom = data.direction === "ZONE_ENTER" ? "CORRIDOR_TRANSIT" : "WORKSPACE_FLOOR";
    const zoneTo = data.direction === "ZONE_ENTER" ? "WORKSPACE_FLOOR" : "CORRIDOR_TRANSIT";

    // 1. Record synthetic manual transit for audit trail
    const vectorHash = await sha256Hex(`manual:${profile.id}:${isoTime}`);
    await context.supabase.from("passive_transits").insert({
      user_id: profile.id,
      camera_id: null,
      zone_from: zoneFrom,
      zone_to: zoneTo,
      direction: data.direction,
      cosine_score: 1.0,
      dram_scrub_ms: 0,
      vector_hash: vectorHash,
    });

    // 2. Fetch or initialize today's attendance record
    const { data: existing } = await context.supabase
      .from("attendance_records")
      .select("*")
      .eq("employee_id", profile.id)
      .eq("attendance_date", today)
      .maybeSingle();

    if (!existing) {
      await context.supabase.from("attendance_records").insert({
        employee_id: profile.id,
        attendance_date: today,
        first_in: data.direction === "ZONE_ENTER" ? isoTime : null,
        last_out: data.direction === "ZONE_EXIT" ? isoTime : null,
        is_manual_entry: true,
        status: "PRESENT",
      });
    } else {
      const updates: Record<string, unknown> = {
        is_manual_entry: true,
        updated_at: isoTime,
      };
      if (data.direction === "ZONE_ENTER" && !existing.first_in) {
        updates["first_in"] = isoTime;
      }
      if (data.direction === "ZONE_EXIT") {
        updates["last_out"] = isoTime;
      }
      await context.supabase.from("attendance_records").update(updates).eq("id", existing.id);
    }

    // 3. Update profile current_zone
    await context.supabase
      .from("enterprise_users")
      .update({
        current_zone: zoneTo,
        is_in_workspace: zoneTo === "WORKSPACE_FLOOR",
      })
      .eq("id", profile.id);

    return {
      success: true,
      message: `Manual ${data.direction === "ZONE_ENTER" ? "Check-in" : "Check-out"} recorded successfully`,
      timestamp: isoTime,
      zone: zoneTo,
    };
  });

/** Retrieve attendance records flagged with missed exit or anomalies (HR/Admin). */
export const getAttendanceAnomalies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["hr_ops", "super_admin"],
    });
    if (!isStaff) throw new Error("Forbidden: HR or Admin access required");

    let query = context.supabase
      .from("attendance_records")
      .select("*, enterprise_users(name, badge_id, department)")
      .or("missed_exit.eq.true,anomaly_reason.not.is.null")
      .order("attendance_date", { ascending: false })
      .limit(100);

    if (data.date) {
      query = query.eq("attendance_date", data.date);
    }

    const { data: anomalies, error } = await query;
    if (error) throw new Error("Failed to load anomalies");

    return { success: true, anomalies: anomalies ?? [] };
  });
