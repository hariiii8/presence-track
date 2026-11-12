import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/presence/layout/AuthShell";
import { playClick, playSweep } from "@/lib/sound-engine";
import { recordAuthEvent } from "@/lib/auth.functions";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Credential Recovery — PresenceTrack AI" },
      { name: "description", content: "Reset your PresenceTrack AI enclave passcode." },
      { property: "og:title", content: "Credential Recovery — PresenceTrack AI" },
      { property: "og:description", content: "Reset your PresenceTrack AI enclave passcode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleRecover = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    playClick();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError("We couldn't send the recovery link. Please try again in a minute.");
      return;
    }
    setSent(true);
    playSweep();

    // Record password recovery request
    recordAuthEvent({
      data: {
        action: "auth.password_reset_request",
        email: email.trim(),
        metadata: { client: "web" },
      },
    }).catch(() => {});
  };

  return (
    <AuthShell>
      <div className="glass-card p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-umbra">Credential Recovery</h1>
            <p className="text-xs text-sage">DPDP statutory identity verification</p>
          </div>
          <Link to="/login" className="text-xs text-sage underline hover:text-umbra">
            Back to login
          </Link>
        </div>

        {sent ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success-strong">
              <Check className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-umbra">Recovery link dispatched</h2>
            <p className="text-xs leading-relaxed text-sage">
              If <strong className="text-umbra">{email}</strong> is enrolled, a one-time link to set
              a new passcode is on its way.
            </p>
            <Link to="/login" className="glass-btn mt-2">
              Return to enclave login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleRecover} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="stat-card-label mb-1.5 block">
                Corporate email
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="alex.rivera@presencetrack.corp"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="glass-input w-full"
              />
            </div>
            <div className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-sage">
              Under DPDP Act 2023 Sec. 12, credential recovery is verified through ownership of your
              corporate mailbox.
            </div>
            <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
              {loading ? "Initiating verification…" : "Send recovery link"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
