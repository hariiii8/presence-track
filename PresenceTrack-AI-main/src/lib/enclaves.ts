import type { UserRole } from "@/lib/ambient";

/**
 * Strict enclave isolation: every role has exactly one console and may not open another.
 */
export type Enclave = "employee" | "hr" | "security" | "admin";

export const ROLE_ENCLAVE: Record<UserRole, Enclave> = {
  employee: "employee",
  hr_ops: "hr",
  security: "security",
  super_admin: "admin",
};

export const ENCLAVE_PATHS = {
  employee: "/enclave/employee",
  hr: "/enclave/hr",
  security: "/enclave/security",
  admin: "/enclave/admin",
} as const satisfies Record<Enclave, string>;

export type EnclavePath = (typeof ENCLAVE_PATHS)[Enclave];

/** People without an assigned role fall back to the employee self-service console. */
export function enclaveFor(role: UserRole | null | undefined): Enclave {
  return role ? ROLE_ENCLAVE[role] : "employee";
}

export function enclavePathFor(role: UserRole | null | undefined): EnclavePath {
  return ENCLAVE_PATHS[enclaveFor(role)];
}

export function canAccessEnclave(role: UserRole | null | undefined, enclave: Enclave): boolean {
  return enclaveFor(role) === enclave;
}
