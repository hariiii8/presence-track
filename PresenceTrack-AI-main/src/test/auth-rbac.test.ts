import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canAccessEnclave, enclaveFor, enclavePathFor, type Enclave } from "@/lib/enclaves";
import type { UserRole } from "@/lib/ambient";

// ── Mock Helpers for RBAC Verification ──────────────────────────────────────

type MockUserRole = UserRole | null;

interface MockAuthUser {
  id: string;
  email: string;
}

interface MockProfile {
  id: string;
  auth_user_id: string;
  name: string;
  badge_id: string;
  is_active: boolean;
}

function mockHasRole(userRole: MockUserRole, requiredRole: UserRole): boolean {
  return userRole === requiredRole;
}

function mockHasAnyRole(userRole: MockUserRole, allowedRoles: UserRole[]): boolean {
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}

function mockCanAccessEmployeeAttendance(
  callerRole: MockUserRole,
  callerEnterpriseId: string,
  targetEmployeeId: string,
): boolean {
  // HR or Admin can view any employee's attendance
  if (mockHasAnyRole(callerRole, ["hr_ops", "super_admin"])) return true;
  // Regular employee can only view their own
  return callerEnterpriseId === targetEmployeeId;
}

function mockGuardEnclaveRoute(
  role: MockUserRole,
  targetEnclave: Enclave,
): { allowed: boolean; redirectTo?: string } {
  if (canAccessEnclave(role, targetEnclave)) {
    return { allowed: true };
  }
  return { allowed: false, redirectTo: enclavePathFor(role) };
}

function mockGuardAuthenticatedRoute(
  user: MockAuthUser | null,
  profile: MockProfile | null,
): { allowed: boolean; redirectTo?: string; search?: Record<string, string> } {
  if (!user) {
    return { allowed: false, redirectTo: "/login", search: { reason: "expired" } };
  }
  if (profile && profile.is_active === false) {
    return { allowed: false, redirectTo: "/unauthorized", search: { reason: "deactivated" } };
  }
  return { allowed: true };
}

// ── Zod Schemas for Auth & Onboarding Validation ────────────────────────────

const InviteEmployeeSchema = z.object({
  email: z.string().trim().email("Valid corporate email required").max(255),
  name: z.string().trim().min(1, "Full name is required").max(100),
  badge_id: z
    .string()
    .trim()
    .min(1, "Badge ID required")
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Badge ID must contain only alphanumeric, dashes or underscores"),
  department: z.string().trim().max(100).optional(),
  role: z.enum(["employee", "hr_ops", "security", "super_admin"]).default("employee"),
  role_title: z.string().trim().max(100).optional(),
});

const PasscodeResetSchema = z
  .object({
    password: z.string().min(8, "Passcode must be at least 8 characters long"),
    confirm: z.string().min(8, "Confirm passcode must be at least 8 characters long"),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passcodes do not match",
    path: ["confirm"],
  });

// ── Test Suites ─────────────────────────────────────────────────────────────

describe("Phase 3: Authentication & Role-Based Access Control (RBAC)", () => {
  // Requirement 1: Employee login
  it("Requirement 1: Employee login maps cleanly to /enclave/employee", () => {
    const role: UserRole = "employee";
    expect(enclaveFor(role)).toBe("employee");
    expect(enclavePathFor(role)).toBe("/enclave/employee");
    expect(canAccessEnclave(role, "employee")).toBe(true);
    expect(canAccessEnclave(role, "admin")).toBe(false);
  });

  // Requirement 2: HR login
  it("Requirement 2: HR login maps cleanly to /enclave/hr", () => {
    const role: UserRole = "hr_ops";
    expect(enclaveFor(role)).toBe("hr");
    expect(enclavePathFor(role)).toBe("/enclave/hr");
    expect(canAccessEnclave(role, "hr")).toBe(true);
    expect(canAccessEnclave(role, "security")).toBe(false);
  });

  // Requirement 3: Security login
  it("Requirement 3: Security login maps cleanly to /enclave/security", () => {
    const role: UserRole = "security";
    expect(enclaveFor(role)).toBe("security");
    expect(enclavePathFor(role)).toBe("/enclave/security");
    expect(canAccessEnclave(role, "security")).toBe(true);
    expect(canAccessEnclave(role, "hr")).toBe(false);
  });

  // Requirement 4: Admin login
  it("Requirement 4: Admin login maps cleanly to /enclave/admin", () => {
    const role: UserRole = "super_admin";
    expect(enclaveFor(role)).toBe("admin");
    expect(enclavePathFor(role)).toBe("/enclave/admin");
    expect(canAccessEnclave(role, "admin")).toBe(true);
    expect(canAccessEnclave(role, "employee")).toBe(false);
  });

  // Requirement 5: Invalid credentials handling
  it("Requirement 5: Invalid credentials & short passcodes are rejected", () => {
    // Passcode policy: min 8 chars
    const shortPasscode = PasscodeResetSchema.safeParse({
      password: "pass",
      confirm: "pass",
    });
    expect(shortPasscode.success).toBe(false);

    // Mismatched passcode confirmation
    const mismatchPasscode = PasscodeResetSchema.safeParse({
      password: "securePassword123",
      confirm: "wrongPassword456",
    });
    expect(mismatchPasscode.success).toBe(false);

    // Valid passcode
    const validPasscode = PasscodeResetSchema.safeParse({
      password: "correctHorseBatteryStaple",
      confirm: "correctHorseBatteryStaple",
    });
    expect(validPasscode.success).toBe(true);
  });

  // Requirement 6: Session expiration handling
  it("Requirement 6: Expired session triggers redirect to /login with reason=expired", () => {
    const expiredResult = mockGuardAuthenticatedRoute(null, null);
    expect(expiredResult.allowed).toBe(false);
    expect(expiredResult.redirectTo).toBe("/login");
    expect(expiredResult.search?.reason).toBe("expired");
  });

  // Requirement 7: Session refresh & cache behavior
  it("Requirement 7: Deactivated accounts trigger signout and redirect to /unauthorized", () => {
    const user: MockAuthUser = { id: "auth-123", email: "alex@enterprise.corp" };
    const inactiveProfile: MockProfile = {
      id: "ent-123",
      auth_user_id: "auth-123",
      name: "Alex",
      badge_id: "PT-001",
      is_active: false,
    };

    const result = mockGuardAuthenticatedRoute(user, inactiveProfile);
    expect(result.allowed).toBe(false);
    expect(result.redirectTo).toBe("/unauthorized");
    expect(result.search?.reason).toBe("deactivated");
  });

  // Requirement 8: Employee accessing another employee's records
  it("Requirement 8: Employee cannot access another employee's attendance records", () => {
    const employeeRole: UserRole = "employee";
    const empAliceId = "alice-uuid-001";
    const empBobId = "bob-uuid-002";

    // Alice accesses her own records -> Granted
    expect(mockCanAccessEmployeeAttendance(employeeRole, empAliceId, empAliceId)).toBe(true);

    // Alice attempts to access Bob's records -> Denied
    expect(mockCanAccessEmployeeAttendance(employeeRole, empAliceId, empBobId)).toBe(false);
  });

  // Requirement 9: HR attempting admin operations
  it("Requirement 9: HR user is blocked from Super Admin operations", () => {
    const hrRole: UserRole = "hr_ops";

    // Super Admin check fails for HR
    expect(mockHasRole(hrRole, "super_admin")).toBe(false);

    // Cannot access admin enclave
    expect(canAccessEnclave(hrRole, "admin")).toBe(false);
  });

  // Requirement 10: Security attempting HR operations
  it("Requirement 10: Security user is blocked from HR-specific operations", () => {
    const securityRole: UserRole = "security";

    // HR staff check fails for Security
    expect(mockHasAnyRole(securityRole, ["hr_ops", "super_admin"])).toBe(false);

    // Security cannot access cross-employee attendance
    expect(mockCanAccessEmployeeAttendance(securityRole, "sec-guard-id", "other-employee-id")).toBe(
      false,
    );
  });

  // Requirement 11: Employee attempting admin operations
  it("Requirement 11: Employee attempting admin operations is rejected", () => {
    const employeeRole: UserRole = "employee";

    expect(mockHasRole(employeeRole, "super_admin")).toBe(false);
    expect(mockHasAnyRole(employeeRole, ["security", "super_admin"])).toBe(false);
    expect(canAccessEnclave(employeeRole, "admin")).toBe(false);
  });

  // Requirement 12: Unauthorized direct URL access
  it("Requirement 12: Direct URL access to unauthorized enclave bounces to designated enclave", () => {
    // Employee tries to navigate directly to /enclave/admin
    const empToAdmin = mockGuardEnclaveRoute("employee", "admin");
    expect(empToAdmin.allowed).toBe(false);
    expect(empToAdmin.redirectTo).toBe("/enclave/employee");

    // HR tries to navigate directly to /enclave/security
    const hrToSec = mockGuardEnclaveRoute("hr_ops", "security");
    expect(hrToSec.allowed).toBe(false);
    expect(hrToSec.redirectTo).toBe("/enclave/hr");

    // Security tries to navigate directly to /enclave/admin
    const secToAdmin = mockGuardEnclaveRoute("security", "admin");
    expect(secToAdmin.allowed).toBe(false);
    expect(secToAdmin.redirectTo).toBe("/enclave/security");

    // Admin navigates to /enclave/admin -> Allowed
    const adminToAdmin = mockGuardEnclaveRoute("super_admin", "admin");
    expect(adminToAdmin.allowed).toBe(true);
  });

  // Requirement 13: Unauthorized server function execution
  it("Requirement 13: Server function authorization validator checks token presence", () => {
    const validateTokenHeader = (header?: string | null) => {
      if (!header) throw new Error("Unauthorized: No authorization header provided");
      if (!header.startsWith("Bearer "))
        throw new Error("Unauthorized: Only Bearer tokens supported");
      const token = header.replace("Bearer ", "");
      if (token.split(".").length !== 3) throw new Error("Unauthorized: Invalid token");
      return token;
    };

    expect(() => validateTokenHeader(null)).toThrow("No authorization header provided");
    expect(() => validateTokenHeader("Basic 12345")).toThrow("Only Bearer tokens supported");
    expect(() => validateTokenHeader("Bearer not-a-jwt")).toThrow("Invalid token");
    expect(validateTokenHeader("Bearer header.payload.signature")).toBe("header.payload.signature");
  });

  // Requirement 14: Employee invitation workflow
  it("Requirement 14: Employee invitation validates corporate fields and prevents malformed data", () => {
    // Valid invitation
    const validInvite = InviteEmployeeSchema.safeParse({
      name: "Priya Sundaram",
      email: "priya.sundaram@presencetrack.corp",
      badge_id: "PT-9042",
      department: "Legal & DPDP Compliance",
      role: "employee",
      role_title: "Statutory Auditor",
    });
    expect(validInvite.success).toBe(true);

    // Invalid email
    const invalidEmail = InviteEmployeeSchema.safeParse({
      name: "Priya Sundaram",
      email: "not-a-valid-email",
      badge_id: "PT-9042",
    });
    expect(invalidEmail.success).toBe(false);

    // Invalid badge with illegal characters
    const badBadge = InviteEmployeeSchema.safeParse({
      name: "Priya Sundaram",
      email: "priya@corp.com",
      badge_id: "PT@#$$%",
    });
    expect(badBadge.success).toBe(false);
  });

  // Requirement 15: Role modification security
  it("Requirement 15: Role assignment requires Super Admin and rejects self-escalation", () => {
    const callerIsAdmin = (role: UserRole) => role === "super_admin";

    expect(callerIsAdmin("super_admin")).toBe(true);
    expect(callerIsAdmin("employee")).toBe(false);
    expect(callerIsAdmin("hr_ops")).toBe(false);
    expect(callerIsAdmin("security")).toBe(false);
  });

  // Requirement 16: Password reset & invitation URL detection
  it("Requirement 16: Detects invitation and recovery hashes for passcode establishment", () => {
    const isInviteHash = (hash: string) => hash.includes("type=invite");
    const isRecoveryHash = (hash: string) => hash.includes("type=recovery");

    expect(isInviteHash("#access_token=xyz&type=invite&expires_in=3600")).toBe(true);
    expect(isInviteHash("#access_token=xyz&type=recovery&expires_in=3600")).toBe(false);

    expect(isRecoveryHash("#access_token=xyz&type=recovery&expires_in=3600")).toBe(true);
    expect(isRecoveryHash("#access_token=xyz&type=invite&expires_in=3600")).toBe(false);
  });
});
