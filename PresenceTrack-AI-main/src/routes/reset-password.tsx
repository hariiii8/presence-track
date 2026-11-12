import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/presence/layout/AuthShell";
import { recordAuthEvent } from "@/lib/auth.functions";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set Enclave Passcode — PresenceTrack AI" },
      {
        name: "description",
        content: "Establish or reset your PresenceTrack AI account passcode.",
      },
      { property: "og:title", content: "Set Enclave Passcode — PresenceTrack AI" },
      {
        property: "og:description",
        content: "Establish or reset your PresenceTrack AI account passcode.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [isInvite, setIsInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const inviteMode = hash.includes("type=invite");
    const recoveryMode = hash.includes("type=recovery");
    setIsInvite(inviteMode);

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session || inviteMode || recoveryMode) setReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Passcode must be at least 8 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passcodes do not match.");
      return;
    }

    setLoading(true);
    const { data: updated, error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    // Record audit event
    if (updated?.user?.id) {
      recordAuthEvent({
        data: {
          action: "auth.password_changed",
          actor_id: updated.user.id,
          metadata: { is_invite_flow: isInvite },
        },
      }).catch(() => {});
    }

    navigate({ to: "/enclave", replace: true });
  };

  return (
    <AuthShell>
      <div className="glass-card p-6 sm:p-8">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success-strong">
          {isInvite ? <ShieldCheck className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
        </div>

        <h1 className="text-lg font-bold text-umbra">
          {isInvite ? "Welcome to PresenceTrack AI — Create Passcode" : "Set a new passcode"}
        </h1>
        <p className="mb-6 text-xs text-sage">
          {isInvite
            ? "Establish a secure corporate passcode to activate your personnel enclave."
            : "This replaces the credential for your PresenceTrack AI account."}
        </p>

        {!ready ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-sage">
              Verifying security link… If not redirected, open this page directly from your
              invitation or recovery email.
            </p>
            <div className="pt-2">
              <Link to="/recovery" className="text-xs text-sage underline hover:text-umbra">
                Request a new recovery link
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-umbra">
                {isInvite ? "Choose passcode" : "New passcode"}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
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

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-xs font-medium text-umbra"
              >
                Confirm passcode
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  required
                  placeholder="Repeat passcode"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="glass-input w-full pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  aria-label={showConfirm ? "Hide passcode" : "Show passcode"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sage hover:text-umbra transition"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-xxs text-sage">
              Passcode policy: Minimum 8 characters. Used exclusively for enclave console
              cryptographic authentication.
            </div>

            <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
              {loading
                ? "Sealing credentials…"
                : isInvite
                  ? "Activate Account & Enter Enclave"
                  : "Save Passcode & Enter Enclave"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
