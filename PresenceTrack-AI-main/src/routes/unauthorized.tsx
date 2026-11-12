import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert, UserX, Clock, Lock, ArrowLeft } from "lucide-react";
import { AuthShell } from "@/components/presence/layout/AuthShell";

type UnauthorizedSearch = {
  reason?: "deactivated" | "forbidden" | "expired" | "role_mismatch";
};

export const Route = createFileRoute("/unauthorized")({
  validateSearch: (search: Record<string, unknown>): UnauthorizedSearch => {
    const reason = search["reason"];
    if (
      reason === "deactivated" ||
      reason === "forbidden" ||
      reason === "expired" ||
      reason === "role_mismatch"
    ) {
      return { reason };
    }
    return {};
  },
  head: () => ({
    meta: [
      { title: "Access Restricted — PresenceTrack AI" },
      {
        name: "description",
        content: "Enclave access restriction under DPDP statutory governance.",
      },
    ],
  }),
  component: UnauthorizedPage,
});

function UnauthorizedPage() {
  const search = Route.useSearch();
  const reason = search.reason || "forbidden";

  const getReasonConfig = () => {
    switch (reason) {
      case "deactivated":
        return {
          icon: UserX,
          iconColor: "text-destructive",
          iconBg: "bg-destructive-soft",
          title: "Account Deactivated",
          description:
            "Your enterprise personnel profile has been marked inactive by your Super Admin. Your active sessions have been terminated in accordance with corporate access control standards.",
          guidance:
            "If you believe this is in error, contact your Organization Administrator or HR Operations to request profile reactivation.",
        };
      case "expired":
        return {
          icon: Clock,
          iconColor: "text-warning-strong",
          iconBg: "bg-warning-soft",
          title: "Session Expired",
          description:
            "Your cryptographic session has expired in compliance with DPDP Act 2023 session retention rules.",
          guidance: "Please sign in again with your corporate credentials to resume access.",
        };
      case "role_mismatch":
        return {
          icon: Lock,
          iconColor: "text-amber-500",
          iconBg: "bg-amber-500/10",
          title: "Enclave Boundary Restricted",
          description:
            "Strict Enclave Isolation is active. Each personnel role has access to exactly one designated console and cross-role navigation is prevented.",
          guidance: "Return to your assigned enclave to view authorized workplace analytics.",
        };
      case "forbidden":
      default:
        return {
          icon: ShieldAlert,
          iconColor: "text-destructive",
          iconBg: "bg-destructive-soft",
          title: "Access Restricted",
          description:
            "You do not possess the required statutory or administrative permissions to perform this operation or view this console.",
          guidance: "Contact your Super Admin if your position requires elevated enclave access.",
        };
    }
  };

  const config = getReasonConfig();
  const Icon = config.icon;

  return (
    <AuthShell>
      <div className="glass-card p-6 sm:p-8">
        <div className="text-center">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${config.iconBg} ${config.iconColor}`}
          >
            <Icon className="h-7 w-7" />
          </div>

          <h1 className="text-xl font-bold text-umbra">{config.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-sage">{config.description}</p>

          <div className="mt-5 rounded-xl border border-border/40 bg-muted/40 p-4 text-left">
            <div className="text-xs font-semibold text-umbra">Statutory Notice</div>
            <p className="mt-1 text-xs leading-relaxed text-sage">{config.guidance}</p>
          </div>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link to="/enclave" className="glass-btn-primary py-2.5 text-xs">
              Go to my enclave
            </Link>
            <Link
              to="/login"
              search={{ reason: "logged_out" }}
              className="glass-btn py-2.5 text-xs"
            >
              Sign in with another account
            </Link>
          </div>

          <div className="mt-6 border-t border-border/40 pt-4">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-sage hover:text-umbra"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to welcome screen
            </Link>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
