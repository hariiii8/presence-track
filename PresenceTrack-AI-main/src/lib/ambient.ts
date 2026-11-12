/**
 * PresenceTrack AI — shared type contracts and constants (browser-safe).
 */
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];

export type UserRole = Database["public"]["Enums"]["app_role"];
export type ZoneType = Database["public"]["Enums"]["zone_type"];
export type TransitDirection = Database["public"]["Enums"]["transit_direction"];
export type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];

export type EnterpriseUser = Tables["enterprise_users"]["Row"];
export type Esp32Node = Tables["esp32_camera_nodes"]["Row"];
export type PassiveTransit = Tables["passive_transits"]["Row"];
export type EmployeeDailyDwell = Tables["employee_daily_dwell"]["Row"];
export type MerkleAuditBlock = Tables["merkle_audit_blocks"]["Row"];
export type DpoErasureRequest = Tables["dpo_erasure_requests"]["Row"];
export type Department = Tables["departments"]["Row"];
export type AttendanceRecord = Tables["attendance_records"]["Row"];
export type AdminAuditLog = Tables["admin_audit_logs"]["Row"];
export type UnknownDetection = Tables["unknown_detections"]["Row"];

export type AttendanceWithEmployee = AttendanceRecord & {
  enterprise_users?: Pick<
    EnterpriseUser,
    "id" | "name" | "badge_id" | "department" | "avatar_url"
  > | null;
};

export type TransitWithPerson = PassiveTransit & {
  enterprise_users: { name: string; badge_id: string } | null;
};

export type ErasureScope =
  | "biometric_embeddings"
  | "transit_history"
  | "dwell_records"
  | "audit_ledger"
  | "compliant_backup";

export const ZONE_LABELS: Record<ZoneType, string> = {
  WORKSPACE_FLOOR: "Workspace Floor",
  CAFETERIA_LOUNGE: "Cafeteria / Lounge",
  OUTDOOR_TERRACE: "Outdoor Terrace",
  CORRIDOR_TRANSIT: "Corridor",
};

export const ZONES: ZoneType[] = [
  "WORKSPACE_FLOOR",
  "CAFETERIA_LOUNGE",
  "OUTDOOR_TERRACE",
  "CORRIDOR_TRANSIT",
];

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "Employee",
  hr_ops: "HR Operations",
  security: "Physical Security",
  super_admin: "Super Admin & Governance",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  HALF_DAY: "Half Day",
  ON_LEAVE: "On Leave",
  HOLIDAY: "Holiday",
};

export const APP_CONFIG = {
  appName: "PresenceTrack AI",
  appVersion: "v1.0.0-PROD",
  dpdpStandard: "DPDP Act 2023 Statutory Standard",
  dramTargetMs: 18,
  cosineThreshold: 0.7,
  workspaceTargetMinutes: 480,
  oshSittingThresholdMinutes: 270,
  /** A node is considered online if it pinged within this window (firmware pings every 15s). */
  nodeOnlineWindowMs: 60_000,
} as const;

export function isNodeLive(
  node: Pick<Esp32Node, "is_online" | "last_ping">,
  now = Date.now(),
): boolean {
  if (!node.is_online || !node.last_ping) return false;
  return now - new Date(node.last_ping).getTime() <= APP_CONFIG.nodeOnlineWindowMs;
}

/** Calendar day in India Standard Time (matches the database dwell accounting). */
export function todayIST(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

export function shortHash(hash: string | null | undefined, len = 16): string {
  if (!hash) return "—";
  return hash.length > len ? `${hash.slice(0, len)}…` : hash;
}
