import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DpoErasureRequest } from "@/lib/ambient";
import { playClick, playSweep } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";

function statusTone(status: string) {
  if (status === "VERIFIED_PURGED") return { dot: "bg-success", text: "text-success-strong" };
  if (status === "ZEROIZING" || status === "SUBMITTED")
    return { dot: "bg-warning", text: "text-warning-strong" };
  return { dot: "bg-sage", text: "text-sage" };
}

/** DPO bridge for Section 12 erasure requests with zeroization on approval. */
export function DpoErasureQueue({
  requests,
  onChanged,
}: {
  requests: DpoErasureRequest[];
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const scope = (r: DpoErasureRequest) =>
    Array.isArray(r.erasure_scope) ? (r.erasure_scope as string[]) : [];
  const active = requests.filter((r) => r.status !== "VERIFIED_PURGED").length;

  const approve = async (r: DpoErasureRequest) => {
    if (
      !window.confirm(
        `Approve erasure for ${r.requestor_name}? This permanently deletes: ${scope(r).join(", ")}.`,
      )
    )
      return;
    playClick();
    setBusy(true);
    const { error } = await supabase.rpc("approve_erasure_request", { _request_id: r.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    playSweep();
    toast.success("Erasure executed and verified");
    onChanged();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-card-label">DPO statutory grievance queue</span>
        <span className="text-xs text-sage">
          {active} active request{active === 1 ? "" : "s"}
        </span>
      </div>
      {requests.length === 0 && (
        <div className="rounded-xl bg-muted p-6 text-center text-sm text-sage">
          No erasure requests filed.
        </div>
      )}
      <div className="space-y-2">
        {requests.map((req) => {
          const tone = statusTone(req.status);
          return (
            <button
              type="button"
              key={req.id}
              onClick={() => setSelectedId(req.id === selectedId ? null : req.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border p-3 text-left transition",
                req.id === selectedId
                  ? "border-umbra/30 bg-umbra/10"
                  : "border-border bg-muted hover:bg-umbra/10",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-umbra">
                    {req.requestor_name} ({req.badge_id})
                  </p>
                  <p className="truncate text-xxs text-sage">
                    {req.email} — {scope(req).join(", ")}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={cn("text-xs font-semibold", tone.text)}>{req.status}</span>
                <span className="text-xxs text-sage">
                  {new Date(req.submitted_at).toLocaleDateString("en-IN", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-umbra">
              Request #{selected.id.slice(0, 8)} — {selected.requestor_name}
            </h4>
            {selected.status !== "VERIFIED_PURGED" && (
              <button
                type="button"
                onClick={() => approve(selected)}
                disabled={busy}
                className="glass-btn-primary"
              >
                <RefreshCcw className="h-4 w-4" /> {busy ? "Zeroizing…" : "Review & approve"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <Field label="Scope" value={scope(selected).join(", ")} mono />
            <Field label="Status" value={selected.status} />
            <Field
              label="Submitted"
              value={new Date(selected.submitted_at).toLocaleString("en-IN")}
              mono
            />
            <Field
              label="Completed"
              value={
                selected.completed_at
                  ? new Date(selected.completed_at).toLocaleString("en-IN")
                  : "Pending verification…"
              }
              mono
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-sage">{label}</p>
      <p className={cn("text-umbra", mono && "font-mono")}>{value}</p>
    </div>
  );
}
