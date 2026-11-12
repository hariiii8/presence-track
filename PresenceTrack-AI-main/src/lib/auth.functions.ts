import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { enclaveFor, type Enclave } from "@/lib/enclaves";
import type { UserRole } from "@/lib/ambient";

/**
 * Audit log helper: records administrative & auth activity to admin_audit_logs.
 * Never logs passwords, secrets or authorization bearer tokens.
 */
async function recordAuditLog(
  supabase: SupabaseClient<Database>,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    // Sanitize metadata to guarantee zero secret leakage
    const sanitizedMeta = { ...metadata };
    delete (sanitizedMeta as Record<string, unknown>).password;
    delete (sanitizedMeta as Record<string, unknown>).passcode;
    delete (sanitizedMeta as Record<string, unknown>).token;
    delete (sanitizedMeta as Record<string, unknown>).access_token;
    delete (sanitizedMeta as Record<string, unknown>).refresh_token;

    await supabase.from("admin_audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: sanitizedMeta as Json,
    });
  } catch (err) {
    console.error("Failed to record auth audit log:", err);
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

// ── Auth Audit Logging ────────────────────────────────────────────────────────

export const recordAuthEvent = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        action: z.enum([
          "auth.login_success",
          "auth.login_failed",
          "auth.logout",
          "auth.password_reset_request",
          "auth.password_changed",
          "auth.session_expired",
          "auth.unauthorized_access",
        ]),
        actor_id: z.string().uuid().optional(),
        email: z.string().trim().email().max(255).optional(),
        metadata: z.record(z.unknown()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { hasSupabaseAdminConfigured, supabaseAdmin } =
      await import("@/integrations/supabase/client.server");

    if (!hasSupabaseAdminConfigured()) {
      return { success: false, reason: "Service role client unavailable" };
    }

    const sanitizedMeta = {
      ...data.metadata,
      ...(data.email ? { email_domain: data.email.split("@")[1] } : {}),
      logged_at: new Date().toISOString(),
    };

    await recordAuditLog(
      supabaseAdmin,
      data.actor_id ?? null,
      data.action,
      "auth",
      data.actor_id ?? null,
      sanitizedMeta,
    );

    return { success: true };
  });

// ── Admin-Initiated Employee Invitation ──────────────────────────────────────

export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        email: z.string().trim().email("Valid corporate email required").max(255),
        name: z.string().trim().min(1, "Full name is required").max(100),
        badge_id: z
          .string()
          .trim()
          .min(1, "Employee/Badge ID is required")
          .max(32)
          .regex(
            /^[A-Za-z0-9_-]+$/,
            "Badge ID must contain only alphanumeric, dashes or underscores",
          ),
        department: z.string().trim().max(100).optional(),
        department_id: z.string().uuid().optional(),
        role: z.enum(["employee", "hr_ops", "security", "super_admin"]).default("employee"),
        role_title: z.string().trim().max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // 1. Enforce Super Admin authorization
    await requireSuperAdmin(context.supabase, context.userId);

    const { hasSupabaseAdminConfigured, supabaseAdmin } =
      await import("@/integrations/supabase/client.server");

    if (!hasSupabaseAdminConfigured()) {
      throw new Error(
        "Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required on server for user invitations",
      );
    }

    const emailNormalized = data.email.toLowerCase().trim();
    const badgeNormalized = data.badge_id.toUpperCase().trim();

    // 2. Validate email and badge uniqueness
    const { data: existingUsers } = await supabaseAdmin
      .from("enterprise_users")
      .select("id, email, badge_id, is_active")
      .or(`email.ilike.${emailNormalized},badge_id.ilike.${badgeNormalized}`);

    if (existingUsers && existingUsers.length > 0) {
      for (const u of existingUsers) {
        if (u.email.toLowerCase() === emailNormalized) {
          throw new Error(`An employee with email '${data.email}' already exists.`);
        }
        if (u.badge_id.toUpperCase() === badgeNormalized) {
          throw new Error(`An employee with Badge ID '${data.badge_id}' already exists.`);
        }
      }
    }

    // 3. Resolve department name
    let departmentName = data.department?.trim() || "General";
    if (data.department_id) {
      const { data: dept } = await supabaseAdmin
        .from("departments")
        .select("name")
        .eq("id", data.department_id)
        .maybeSingle();
      if (dept?.name) departmentName = dept.name;
    }

    // 4. Pre-stage the enterprise_users record
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      data.name,
    )}&background=10B981&color=fff&bold=true`;

    const { data: stagedProfile, error: profileErr } = await supabaseAdmin
      .from("enterprise_users")
      .insert({
        name: data.name.trim(),
        email: emailNormalized,
        badge_id: badgeNormalized,
        department: departmentName,
        role_title: data.role_title?.trim() || "Staff",
        imported_role: data.role,
        avatar_url: avatarUrl,
      })
      .select()
      .single();

    if (profileErr) {
      throw new Error(`Failed to stage employee profile: ${profileErr.message}`);
    }

    // 5. Send invitation via Supabase Auth
    const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "http://localhost:3000";

    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      emailNormalized,
      {
        data: {
          name: data.name.trim(),
          badge_id: badgeNormalized,
          department: departmentName,
          role: data.role,
        },
        redirectTo: `${appUrl}/reset-password`,
      },
    );

    if (inviteErr) {
      // Rollback staged record if invitation dispatch fails
      await supabaseAdmin.from("enterprise_users").delete().eq("id", stagedProfile.id);
      throw new Error(`Supabase invite dispatch failed: ${inviteErr.message}`);
    }

    // 6. If auth user was created, link immediately and establish role
    if (inviteData?.user?.id) {
      await supabaseAdmin
        .from("enterprise_users")
        .update({ auth_user_id: inviteData.user.id })
        .eq("id", stagedProfile.id);

      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: inviteData.user.id, role: data.role }, { onConflict: "user_id" });
    }

    // 7. Audit log the invitation
    await recordAuditLog(
      context.supabase,
      context.userId,
      "employee.invited",
      "enterprise_users",
      stagedProfile.id,
      {
        email: emailNormalized,
        name: data.name.trim(),
        badge_id: badgeNormalized,
        role: data.role,
        department: departmentName,
        auth_user_id: inviteData?.user?.id ?? null,
      },
    );

    return {
      success: true,
      message: `Invitation successfully dispatched to ${data.email}`,
      employee: {
        id: stagedProfile.id,
        email: stagedProfile.email,
        name: stagedProfile.name,
        badge_id: stagedProfile.badge_id,
        department: stagedProfile.department,
        role: data.role,
      },
    };
  });

// ── Reinvite Employee ────────────────────────────────────────────────────────

export const reinviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ employee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const { hasSupabaseAdminConfigured, supabaseAdmin } =
      await import("@/integrations/supabase/client.server");

    if (!hasSupabaseAdminConfigured()) {
      throw new Error(
        "Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required on server for invitations",
      );
    }

    const { data: emp, error } = await supabaseAdmin
      .from("enterprise_users")
      .select("id, email, name, badge_id, department, imported_role, auth_user_id")
      .eq("id", data.employee_id)
      .maybeSingle();

    if (error || !emp) throw new Error("Employee not found");

    const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || "http://localhost:3000";

    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(emp.email, {
      data: {
        name: emp.name,
        badge_id: emp.badge_id,
        department: emp.department,
        role: emp.imported_role,
      },
      redirectTo: `${appUrl}/reset-password`,
    });

    if (inviteErr) {
      throw new Error(`Failed to resend invitation: ${inviteErr.message}`);
    }

    await recordAuditLog(
      context.supabase,
      context.userId,
      "employee.reinvited",
      "enterprise_users",
      emp.id,
      { email: emp.email, badge_id: emp.badge_id },
    );

    return { success: true, message: `Invitation resent to ${emp.email}` };
  });

// ── Activate Employee ────────────────────────────────────────────────────────

export const activateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ employee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);

    const { data: emp, error } = await context.supabase
      .from("enterprise_users")
      .update({ is_active: true })
      .eq("id", data.employee_id)
      .select("id, name, email, badge_id")
      .single();

    if (error || !emp) throw new Error("Failed to activate employee");

    await recordAuditLog(
      context.supabase,
      context.userId,
      "employee.activated",
      "enterprise_users",
      emp.id,
      { email: emp.email, badge_id: emp.badge_id },
    );

    return { success: true, message: `Employee ${emp.name} has been activated.` };
  });

// ── Session Status & Enclave Resolver ────────────────────────────────────────

export const getSessionAuthDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("enterprise_users")
        .select(
          "id, auth_user_id, email, name, badge_id, department, role_title, avatar_url, current_zone, is_in_workspace, consent_revoked, created_at",
        )
        .eq("auth_user_id", context.userId)
        .maybeSingle(),
    ]);

    const role = (roleRow?.role ?? null) as UserRole | null;
    const enclave: Enclave = enclaveFor(role);
    const isActive = profile ? profile.is_active !== false : true;

    return {
      authenticated: true,
      userId: context.userId,
      role,
      enclave,
      isActive,
      profile: profile ?? null,
    };
  });
