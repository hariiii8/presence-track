import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Session lives in browser storage, so the gate runs client-side only.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw redirect({
        to: "/login",
        search: { reason: "expired" },
      });
    }

    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("enterprise_users")
        .select(
          "id, auth_user_id, email, name, badge_id, department, role_title, avatar_url, current_zone, is_in_workspace, consent_revoked, created_at",
        )
        .eq("auth_user_id", user.id)
        .maybeSingle(),
    ]);

    const profileData = profile
      ? {
          ...profile,
          is_active: (profile as { is_active?: boolean }).is_active ?? true,
          department_id: (profile as { department_id?: string | null }).department_id ?? null,
        }
      : null;

    // Deactivated account check - immediately terminate session and redirect
    if (profileData && profileData.is_active === false) {
      await supabase.auth.signOut();
      throw redirect({
        to: "/unauthorized",
        search: { reason: "deactivated" },
      });
    }

    return { user, role: roleRow?.role ?? null, profile: profileData };
  },
  component: () => <Outlet />,
});
