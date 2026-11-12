import { createFileRoute, Outlet, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AmbientBackground } from "@/components/presence/layout/AmbientBackground";
import { EnclaveHeader } from "@/components/presence/layout/EnclaveHeader";
import { recordAuthEvent } from "@/lib/auth.functions";

/** Enclave shell — no sidebar navigation; each role sees only its own console. */
export const Route = createFileRoute("/_authenticated/enclave")({
  component: EnclaveLayout,
});

function EnclaveLayout() {
  const { user, role, profile } = useRouteContext({ from: "/_authenticated" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    if (user?.id) {
      recordAuthEvent({
        data: {
          action: "auth.logout",
          actor_id: user.id,
          email: user.email ?? undefined,
        },
      }).catch(() => {});
    }
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { reason: "logged_out" }, replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <AmbientBackground />
      <EnclaveHeader
        name={profile?.name ?? user.email ?? ""}
        badgeId={profile?.badge_id ?? ""}
        avatarUrl={profile?.avatar_url ?? null}
        role={role}
        onSignOut={handleSignOut}
      />
      <main className="relative z-10 pt-20">
        <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
