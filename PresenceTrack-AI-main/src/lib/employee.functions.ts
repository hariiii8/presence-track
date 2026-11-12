import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { encryptBiometricTemplate, isValidEmbedding } from "@/lib/biometric";

type UserRole = Database["public"]["Enums"]["app_role"];

/**
 * Audit log helper: records administrative activity to admin_audit_logs.
 */
async function recordAdminAudit(
  supabase: SupabaseClient<Database>,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await supabase.from("admin_audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata as Json,
    });
  } catch (err) {
    console.error("Failed to record admin audit log:", err);
  }
}

/** Check if current caller has super_admin role */
async function requireSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (!isAdmin) throw new Error("Forbidden: Super Admin access required");
}

/** Check if current caller has HR or Admin role */
async function requireHrOrAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data: isAllowed } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["hr_ops", "super_admin"],
  });
  if (!isAllowed) throw new Error("Forbidden: HR or Admin access required");
}

// ── Employee CRUD Server Functions ──────────────────────────────────────────

/** Create a new enterprise employee profile (Super Admin only). */
export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().trim().min(1, "Name is required").max(100),
        email: z.string().trim().email("Valid email required").max(255),
        badge_id: z.string().trim().min(1, "Badge ID required").max(64),
        department_id: z.string().uuid().optional().nullable(),
        department_name: z.string().trim().max(100).optional(),
        role_title: z.string().trim().min(1).max(100).default("Staff"),
        employment_type: z.string().trim().default("FULL_TIME"),
        shift_start: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/)
          .default("09:00:00"),
        shift_end: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/)
          .default("18:00:00"),
        initial_role: z.enum(["employee", "hr_ops", "security", "super_admin"]).default("employee"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    // Resolve department name if department_id provided
    let deptName = data.department_name || "Unassigned";
    if (data.department_id) {
      const { data: dept } = await context.supabase
        .from("departments")
        .select("name")
        .eq("id", data.department_id)
        .maybeSingle();
      if (dept) deptName = dept.name;
    }

    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=10B981&color=fff&bold=true`;

    const { data: created, error } = await context.supabase
      .from("enterprise_users")
      .insert({
        name: data.name,
        email: data.email.toLowerCase(),
        badge_id: data.badge_id.toUpperCase(),
        department: deptName,
        role_title: data.role_title,
        avatar_url: avatarUrl,
        imported_role: data.initial_role,
      })
      .select("id, name, email, badge_id, department, role_title, created_at")
      .single();

    if (error || !created) {
      if (error?.code === "23505") {
        throw new Error("An employee with this email or badge ID already exists.");
      }
      throw new Error(error?.message || "Failed to create employee profile");
    }

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "CREATE_EMPLOYEE",
      "enterprise_users",
      created.id,
      { name: created.name, email: created.email, badge_id: created.badge_id },
    );

    return { success: true, employee: created };
  });

/** Update an existing employee profile (HR or Admin). */
export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        badge_id: z.string().trim().min(1).max(64).optional(),
        department_id: z.string().uuid().optional().nullable(),
        department_name: z.string().trim().max(100).optional(),
        role_title: z.string().trim().max(100).optional(),
        employment_type: z.string().trim().optional(),
        shift_start: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/)
          .optional(),
        shift_end: z
          .string()
          .regex(/^\d{2}:\d{2}(:\d{2})?$/)
          .optional(),
        avatar_url: z.string().url().max(500).optional().nullable(),
        is_active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireHrOrAdmin(context.supabase, context.userId);

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates["name"] = data.name;
    if (data.badge_id !== undefined) updates["badge_id"] = data.badge_id.toUpperCase();
    if (data.role_title !== undefined) updates["role_title"] = data.role_title;
    if (data.employment_type !== undefined) updates["employment_type"] = data.employment_type;
    if (data.shift_start !== undefined) updates["shift_start"] = data.shift_start;
    if (data.shift_end !== undefined) updates["shift_end"] = data.shift_end;
    if (data.avatar_url !== undefined) updates["avatar_url"] = data.avatar_url;
    if (data.is_active !== undefined) updates["is_active"] = data.is_active;

    if (data.department_id !== undefined) {
      updates["department_id"] = data.department_id;
      if (data.department_id) {
        const { data: dept } = await context.supabase
          .from("departments")
          .select("name")
          .eq("id", data.department_id)
          .maybeSingle();
        if (dept) updates["department"] = dept.name;
      }
    } else if (data.department_name !== undefined) {
      updates["department"] = data.department_name;
    }

    const { data: updated, error } = await context.supabase
      .from("enterprise_users")
      .update(updates)
      .eq("id", data.id)
      .select("id, name, email, badge_id, department, role_title")
      .single();

    if (error || !updated) {
      throw new Error(error?.message || "Failed to update employee");
    }

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "UPDATE_EMPLOYEE",
      "enterprise_users",
      data.id,
      updates,
    );

    return { success: true, employee: updated };
  });

/** Deactivate an employee profile (Super Admin only). */
export const deactivateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(255).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const { error } = await context.supabase
      .from("enterprise_users")
      .update({ is_active: false })
      .eq("id", data.id);

    if (error) throw new Error("Failed to deactivate employee");

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "DEACTIVATE_EMPLOYEE",
      "enterprise_users",
      data.id,
      { reason: data.reason || "Administrative deactivation" },
    );

    return { success: true, message: "Employee deactivated successfully" };
  });

/** Retrieve single employee profile (omitting biometric embedding). */
export const getEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: emp, error } = await context.supabase
      .from("enterprise_users")
      .select(
        "id, auth_user_id, email, name, badge_id, department, role_title, avatar_url, current_zone, is_in_workspace, consent_revoked, created_at",
      )
      .eq("id", data.id)
      .maybeSingle();

    if (error || !emp) throw new Error("Employee not found");
    const fullEmp = {
      ...emp,
      is_active: (emp as { is_active?: boolean }).is_active ?? true,
      department_id: (emp as { department_id?: string | null }).department_id ?? null,
      employment_type: (emp as { employment_type?: string }).employment_type ?? "FULL_TIME",
      shift_start: (emp as { shift_start?: string }).shift_start ?? "09:00:00",
      shift_end: (emp as { shift_end?: string }).shift_end ?? "18:00:00",
    };
    return { success: true, employee: fullEmp };
  });

/** List employees with optional filters (strips biometric embeddings). */
export const listEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        department_id: z.string().uuid().optional(),
        search: z.string().trim().max(100).optional(),
        include_inactive: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const query = context.supabase
      .from("enterprise_users")
      .select(
        "id, auth_user_id, email, name, badge_id, department, role_title, avatar_url, current_zone, is_in_workspace, consent_revoked, created_at",
      )
      .order("name", { ascending: true });

    const { data: employees, error } = await query;
    if (error) throw new Error("Failed to list employees");

    const mapped = (employees ?? []).map((emp) => ({
      ...emp,
      is_active: (emp as { is_active?: boolean }).is_active ?? true,
      department_id: (emp as { department_id?: string | null }).department_id ?? null,
      employment_type: (emp as { employment_type?: string }).employment_type ?? "FULL_TIME",
      shift_start: (emp as { shift_start?: string }).shift_start ?? "09:00:00",
      shift_end: (emp as { shift_end?: string }).shift_end ?? "18:00:00",
    }));

    let filtered = mapped;
    if (!data.include_inactive) {
      filtered = filtered.filter((e) => e.is_active);
    }
    if (data.department_id) {
      filtered = filtered.filter((e) => e.department_id === data.department_id);
    }
    if (data.search) {
      const q = data.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.badge_id.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q),
      );
    }

    return { success: true, employees: filtered, count: filtered.length };
  });

/** Assign enclave role to an authorized user (Super Admin only). */
export const assignEmployeeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        auth_user_id: z.string().uuid(),
        role: z.enum(["employee", "hr_ops", "security", "super_admin"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const { error } = await context.supabase
      .from("user_roles")
      .upsert({ user_id: data.auth_user_id, role: data.role }, { onConflict: "user_id" });

    if (error) throw new Error(error.message);

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "ASSIGN_ROLE",
      "user_roles",
      data.auth_user_id,
      { assigned_role: data.role },
    );

    return { success: true, role: data.role };
  });

// ── Department Management Server Functions (Task 5) ─────────────────────────

/** List all departments with employee headcounts. */
export const listDepartments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: depts, error: dError }, { data: people, error: pError }] = await Promise.all([
      context.supabase.from("departments").select("*").order("name", { ascending: true }),
      context.supabase.from("enterprise_users").select("id, department"),
    ]);

    if (dError) throw new Error("Failed to load departments");

    const counts = new Map<string, number>();
    for (const p of people ?? []) {
      const deptKey = (p as { department_id?: string }).department_id ?? p.department;
      if (deptKey) {
        counts.set(deptKey, (counts.get(deptKey) ?? 0) + 1);
      }
    }

    const items = (depts ?? []).map((d) => ({
      ...d,
      active_employees: counts.get(d.id) ?? counts.get(d.name) ?? 0,
    }));

    return { success: true, departments: items };
  });

/** Create a new department (Super Admin only). */
export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().trim().min(1, "Department name is required").max(100),
        description: z.string().trim().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const { data: dept, error } = await context.supabase
      .from("departments")
      .insert({
        name: data.name,
        description: data.description || null,
      })
      .select("*")
      .single();

    if (error || !dept) {
      if (error?.code === "23505") throw new Error("A department with this name already exists.");
      throw new Error(error?.message || "Failed to create department");
    }

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "CREATE_DEPARTMENT",
      "departments",
      dept.id,
      { name: dept.name },
    );

    return { success: true, department: dept };
  });

/** Update department details (Super Admin only). */
export const updateDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(255).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates["name"] = data.name;
    if (data.description !== undefined) updates["description"] = data.description;

    const { data: dept, error } = await context.supabase
      .from("departments")
      .update(updates)
      .eq("id", data.id)
      .select("*")
      .single();

    if (error || !dept) throw new Error(error?.message || "Failed to update department");

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "UPDATE_DEPARTMENT",
      "departments",
      dept.id,
      updates,
    );

    return { success: true, department: dept };
  });

/**
 * Enroll or update an employee's facial biometric template (Super Admin only).
 * Complies with DPDP Act 2023:
 * - Templates are validated (128-d or 512-d float vectors)
 * - Templates are encrypted at rest using AES-256-GCM via encryptBiometricTemplate()
 * - Plaintext vectors are never persisted to database or returned to client
 */
export const enrollEmployeeBiometrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        employee_id: z.string().uuid("Valid employee ID required"),
        embedding: z
          .array(z.number())
          .refine(
            (vec) => isValidEmbedding(vec, 128) || isValidEmbedding(vec, 512),
            "Embedding must be a valid 128 or 512 dimensional floating point vector",
          ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    // Verify target employee exists
    const { data: emp, error: empErr } = await context.supabase
      .from("enterprise_users")
      .select("id, name, badge_id, consent_revoked")
      .eq("id", data.employee_id)
      .maybeSingle();

    if (empErr || !emp) {
      throw new Error("Employee not found");
    }

    if (emp.consent_revoked) {
      throw new Error(
        "Cannot enroll biometrics for employee with revoked consent (DPDP Section 6)",
      );
    }

    // Encrypt template via AES-256-GCM before storage
    const encryptedTemplate = await encryptBiometricTemplate(data.embedding);

    const { error: updateErr } = await context.supabase
      .from("enterprise_users")
      .update({
        enrolled_embedding: encryptedTemplate as unknown as Json,
      })
      .eq("id", data.employee_id);

    if (updateErr) {
      throw new Error(`Failed to store biometric template: ${updateErr.message}`);
    }

    await recordAdminAudit(
      context.supabase,
      context.userId,
      "BIOMETRICS_ENROLLED",
      "enterprise_users",
      emp.id,
      {
        embedding_dim: data.embedding.length,
        encrypted: encryptedTemplate.encrypted,
        enrolled_at: new Date().toISOString(),
      },
    );

    return {
      success: true,
      employee_id: emp.id,
      encrypted: encryptedTemplate.encrypted,
      message: "Biometric template securely encrypted and enrolled",
    };
  });

// Re-export onboarding & account lifecycle functions
export { inviteEmployee, reinviteEmployee, activateEmployee } from "@/lib/auth.functions";
