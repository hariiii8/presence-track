import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  AdminAuditLog,
  AttendanceRecord,
  Department,
  DpoErasureRequest,
  EmployeeDailyDwell,
  EnterpriseUser,
  Esp32Node,
  MerkleAuditBlock,
  TransitWithPerson,
  UnknownDetection,
  UserRole,
} from "@/lib/ambient";
import { todayIST } from "@/lib/ambient";

/** All reads go through the signed-in browser client, so access rules apply per role. */

function dayBoundsIST(day: string) {
  return { from: `${day}T00:00:00+05:30`, to: `${day}T23:59:59.999+05:30` };
}

export const myDwellQuery = (enterpriseId: string) =>
  queryOptions({
    queryKey: ["dwell", "me", enterpriseId, todayIST()],
    queryFn: async (): Promise<EmployeeDailyDwell | null> => {
      const { data, error } = await supabase
        .from("employee_daily_dwell")
        .select("*")
        .eq("user_id", enterpriseId)
        .eq("record_date", todayIST())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const myTransitsQuery = (enterpriseId: string) =>
  queryOptions({
    queryKey: ["transits", "me", enterpriseId],
    queryFn: async (): Promise<TransitWithPerson[]> => {
      const { data, error } = await supabase
        .from("passive_transits")
        .select("*, enterprise_users(name, badge_id)")
        .eq("user_id", enterpriseId)
        .order("timestamp", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TransitWithPerson[];
    },
  });

export const recentTransitsQuery = () =>
  queryOptions({
    queryKey: ["transits", "recent"],
    queryFn: async (): Promise<TransitWithPerson[]> => {
      const { data, error } = await supabase
        .from("passive_transits")
        .select("*, enterprise_users(name, badge_id)")
        .order("timestamp", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as TransitWithPerson[];
    },
  });

export const todayTransitsQuery = () =>
  queryOptions({
    queryKey: ["transits", "today", todayIST()],
    queryFn: async () => {
      const { from, to } = dayBoundsIST(todayIST());
      const { data, error } = await supabase
        .from("passive_transits")
        .select("timestamp, direction, zone_to")
        .gte("timestamp", from)
        .lte("timestamp", to)
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

export const nodesQuery = () =>
  queryOptions({
    queryKey: ["nodes"],
    queryFn: async (): Promise<Esp32Node[]> => {
      const { data, error } = await supabase.from("esp32_camera_nodes").select("*").order("id");
      if (error) throw error;
      return data ?? [];
    },
  });

export interface LiveTelemetry {
  camera_id: string;
  is_live: boolean;
  face_detected: boolean;
  face_bounding_box: { x: number; y: number; w: number; h: number } | null;
  sc_score: number;
  matched_name: string | null;
  person_count: number;
  active_tracks: number;
  last_event: string | null;
  updated_at: string;
}

export const liveTelemetryQuery = () =>
  queryOptions({
    queryKey: ["telemetry", "live"],
    queryFn: async (): Promise<LiveTelemetry> => {
      try {
        const resp = await fetch("/api/public/esp32/telemetry");
        if (!resp.ok) throw new Error("Failed to fetch telemetry");
        const json = await resp.json();
        return json.telemetry;
      } catch {
        return {
          camera_id: "ESP32-CAM-01-NORTH",
          is_live: false,
          face_detected: false,
          face_bounding_box: null,
          sc_score: 0,
          matched_name: null,
          person_count: 0,
          active_tracks: 0,
          last_event: null,
          updated_at: new Date().toISOString(),
        };
      }
    },
    refetchInterval: 1000,
  });

export const merkleBlocksQuery = () =>
  queryOptions({
    queryKey: ["merkle-blocks"],
    queryFn: async (): Promise<MerkleAuditBlock[]> => {
      const { data, error } = await supabase
        .from("merkle_audit_blocks")
        .select("*")
        .order("block_height", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

export const erasureRequestsQuery = () =>
  queryOptions({
    queryKey: ["erasure-requests"],
    queryFn: async (): Promise<DpoErasureRequest[]> => {
      const { data, error } = await supabase
        .from("dpo_erasure_requests")
        .select("*")
        .order("submitted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

export const myErasureRequestsQuery = (enterpriseId: string) =>
  queryOptions({
    queryKey: ["erasure-requests", "me", enterpriseId],
    queryFn: async (): Promise<DpoErasureRequest[]> => {
      const { data, error } = await supabase
        .from("dpo_erasure_requests")
        .select("*")
        .eq("user_id", enterpriseId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const personnelQuery = () =>
  queryOptions({
    queryKey: ["personnel"],
    queryFn: async (): Promise<EnterpriseUser[]> => {
      // Explicitly exclude enrolled_embedding to prevent biometric vector leakage
      const { data, error } = await supabase
        .from("enterprise_users")
        .select(
          "id, auth_user_id, email, name, badge_id, department, role_title, avatar_url, current_zone, is_in_workspace, consent_revoked, created_at",
        )
        .order("name");
      if (error) throw error;
      return (data ?? []).map((u) => ({
        ...u,
        is_active: (u as { is_active?: boolean }).is_active ?? true,
        department_id: (u as { department_id?: string | null }).department_id ?? null,
        employment_type: (u as { employment_type?: string }).employment_type ?? "FULL_TIME",
        shift_start: (u as { shift_start?: string }).shift_start ?? "09:00:00",
        shift_end: (u as { shift_end?: string }).shift_end ?? "18:00:00",
      })) as EnterpriseUser[];
    },
  });

export const rolesQuery = () =>
  queryOptions({
    queryKey: ["roles"],
    queryFn: async (): Promise<Record<string, UserRole>> => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.user_id, r.role]));
    },
  });

export const teamDwellQuery = () =>
  queryOptions({
    queryKey: ["dwell", "team", todayIST()],
    queryFn: async (): Promise<EmployeeDailyDwell[]> => {
      const { data, error } = await supabase
        .from("employee_daily_dwell")
        .select("*")
        .eq("record_date", todayIST());
      if (error) throw error;
      return data ?? [];
    },
  });

export const departmentsQuery = () =>
  queryOptions({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

export const todayAttendanceQuery = () =>
  queryOptions({
    queryKey: ["attendance", "today", todayIST()],
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("attendance_date", todayIST());
      if (error) throw error;
      return data ?? [];
    },
  });

export const myAttendanceRecordsQuery = (employeeId: string) =>
  queryOptions({
    queryKey: ["attendance", "me", employeeId],
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId)
        .order("attendance_date", { ascending: false })
        .limit(31);
      if (error) throw error;
      return data ?? [];
    },
  });

export const adminAuditLogsQuery = (limit = 50) =>
  queryOptions({
    queryKey: ["audit-logs", limit],
    queryFn: async (): Promise<AdminAuditLog[]> => {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });

export const unknownDetectionsQuery = () =>
  queryOptions({
    queryKey: ["unknown-detections"],
    queryFn: async (): Promise<UnknownDetection[]> => {
      const { data, error } = await supabase
        .from("unknown_detections")
        .select("*")
        .eq("reviewed_status", "PENDING")
        .order("detected_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
