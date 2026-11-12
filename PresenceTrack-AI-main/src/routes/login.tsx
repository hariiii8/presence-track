import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Building2,
  ShieldCheck,
  Users,
  Video,
  Eye,
  EyeOff,
  Clock,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/presence/layout/AuthShell";
import { playClick, playTransitBlip } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";
import { enclavePathFor } from "@/lib/enclaves";
import { recordAuthEvent } from "@/lib/auth.functions";
import type { UserRole } from "@/lib/ambient";

type LoginSearch = {
  mode?: "signin" | "setup";
  reason?: "expired" | "deactivated" | "logged_out";
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const mode = search["mode"];
    const reason = search["reason"];
    return {
      mode:
        mode === "signup" || mode === "signin"
          ? mode === "signup"
            ? "setup"
            : "signin"
          : undefined,
      reason:
        reason === "expired" || reason === "deactivated" || reason === "logged_out"
          ? reason
          : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Secure Access — PresenceTrack AI" },
      { name: "description", content: "Sign in to your designated PresenceTrack AI enclave." },
      { property: "og:title", content: "Secure Access — PresenceTrack AI" },
      {
        property: "og:description",
        content: "Sign in to your designated PresenceTrack AI enclave.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

const ENCLAVES = [
  {
    icon: Building2,
    label: "Employee",
    text: "Personal dwell time, transit ledger and DPDP vault",
  },
  {
    icon: Users,
    label: "HR Operations",
    text: "Concourse presence, team Gantt, OSH alerts, CSV export",
  },
  {
    icon: Video,
    label: "Physical Security",
    text: "ESP32-CAM matrix, node configuration, live transits",
  },
  {
    icon: ShieldCheck,
    label: "Super Admin",
    text: "Merkle ledger, attestation, DPO queue, role assignment",
  },
];

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "setup">(
    search.mode === "setup" ? "setup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Already signed in → route straight to assigned enclave (unless explicit logout or expired reason)
  useEffect(() => {
    if (search.reason === "logged_out" || search.reason === "expired") {
      void supabase.auth.signOut();
      return;
    }

    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user) {
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .maybeSingle();
        navigate({ to: enclavePathFor(roleRow?.role as UserRole), replace: true });
      }
    });
  }, [navigate, search.reason]);

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const emailTrimmed = email.trim();
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: emailTrimmed,
      password,
    });

    setLoading(false);

    if (authErr) {
      // Record failed authentication attempt safely (no password in logs)
      recordAuthEvent({
        data: {
          action: "auth.login_failed",
          email: emailTrimmed,
          metadata: { reason: authErr.message },
        },
      }).catch(() => {});

      setError(
        /confirm/i.test(authErr.message)
          ? "Please verify your email first — open the verification link we sent you."
          : "Invalid corporate email or passcode.",
      );
      return;
    }

    // Check role and enterprise profile
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", authData.user.id).maybeSingle(),
      supabase
        .from("enterprise_users")
        .select("is_active")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle(),
    ]);

    // Check if account is deactivated
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      navigate({ to: "/unauthorized", search: { reason: "deactivated" }, replace: true });
      return;
    }

    // Record successful login audit
    recordAuthEvent({
      data: {
        action: "auth.login_success",
        actor_id: authData.user.id,
        email: emailTrimmed,
        metadata: { role: roleRow?.role ?? "unassigned" },
      },
    }).catch(() => {});

    playClick();
    playTransitBlip();

    const target = enclavePathFor(roleRow?.role as UserRole);
    navigate({ to: target, replace: true });
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Choose a passcode of at least 8 characters.");
      return;
    }
    setLoading(true);
    const { error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { name: name.trim() },
      },
    });
    setLoading(false);
    if (signUpErr) {
      setError(signUpErr.message);
      return;
    }
    playClick();
    setSentTo(email.trim());
  };

  return (
    <AuthShell>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-sage hover:text-umbra"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to welcome
      </Link>

      {/* Reason banner alerts */}
      {search.reason === "expired" && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning-strong/30 bg-warning-soft p-3.5 text-xs text-warning-strong">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            Your cryptographic session has expired in compliance with DPDP Act 2023. Please
            authenticate again.
          </span>
        </div>
      )}

      {search.reason === "deactivated" && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive-soft p-3.5 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Your enterprise profile has been deactivated by Super Admin. Contact HR Operations for
            assistance.
          </span>
        </div>
      )}

      {search.reason === "logged_out" && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-success-strong/30 bg-success-soft p-3.5 text-xs text-success-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>You have securely signed out of your enclave.</span>
        </div>
      )}

      <div className="glass-card p-6 sm:p-8">
        <div className="mb-6 flex rounded-xl bg-muted p-1">
          {(["signin", "setup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
                setSentTo(null);
              }}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition",
                mode === m ? "bg-card text-umbra shadow-sm" : "text-sage hover:text-umbra",
              )}
            >
              {m === "signin" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        {sentTo ? (
          <div className="space-y-3 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success-strong">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-umbra">Verify your corporate email</h2>
            <p className="text-sm text-sage">
              We sent a verification link to <strong className="text-umbra">{sentTo}</strong>. Open
              it to activate your enclave access, then sign in with your new passcode.
            </p>
          </div>
        ) : (
          <form onSubmit={mode === "signin" ? handleSignIn : handleSetup} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-umbra">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm text-sage">
                {mode === "signin"
                  ? "Enter your corporate credentials to access your designated enclave."
                  : "Existing personnel: use your corporate email — your profile and history are linked once you verify it."}
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {mode === "setup" && (
              <div>
                <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-umbra">
                  Full name
                </label>
                <input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="glass-input w-full"
                  disabled={loading}
                  maxLength={100}
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-umbra">
                Corporate email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex.rivera@presencetrack.corp"
                className="glass-input w-full"
                disabled={loading}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-umbra">
                  {mode === "signin" ? "Passcode" : "Choose a passcode"}
                </label>
                {mode === "signin" && (
                  <Link to="/recovery" className="text-xs text-sage underline hover:text-umbra">
                    Forgot passcode?
                  </Link>
                )}
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input w-full pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide passcode" : "Show passcode"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sage hover:text-umbra transition"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="glass-btn-primary w-full py-3">
              {loading
                ? "Authenticating…"
                : mode === "signin"
                  ? "Authenticate and enter enclave"
                  : "Send verification link"}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ENCLAVES.map(({ icon: Icon, label, text }) => (
          <div key={label} className="stat-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-umbra">
              <Icon className="h-4 w-4 text-success-strong" />
              {label}
            </div>
            <p className="mt-1 text-xs text-sage">{text}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-sage">
        Strict Enclave Isolation: your console is assigned by your corporate role.
      </p>
    </AuthShell>
  );
}
