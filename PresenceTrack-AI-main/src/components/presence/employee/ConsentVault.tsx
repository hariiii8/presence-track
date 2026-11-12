import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Fingerprint, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DpoErasureRequest, EnterpriseUser, ErasureScope } from "@/lib/ambient";
import { generateAuditCertificate } from "@/lib/presence.functions";
import { downloadText } from "@/lib/download";
import { playClick, playSweep } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/presence/layout/Modal";

const SCOPES: { id: ErasureScope; label: string }[] = [
  { id: "biometric_embeddings", label: "Biometric template" },
  { id: "transit_history", label: "Transit history" },
  { id: "dwell_records", label: "Dwell records" },
];

interface ConsentVaultProps {
  profile: EnterpriseUser;
  requests: DpoErasureRequest[];
}

/** DPDP Sec. 12 — right to erasure and cryptographic audit certificate. */
export function ConsentVault({ profile, requests }: ConsentVaultProps) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ErasureScope[]>(["biometric_embeddings", "transit_history"]);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const getCert = useServerFn(generateAuditCertificate);
  const revoked = profile.consent_revoked;
  const embedding = profile.enrolled_embedding as {
    enrolledAt?: string;
    dimensions?: unknown[];
  } | null;

  const refresh = async () => {
    await router.invalidate();
    await queryClient.invalidateQueries({ queryKey: ["erasure-requests"] });
  };

  const toggle = async () => {
    playClick();
    setBusy(true);
    try {
      if (!revoked) {
        if (scope.length === 0) {
          toast.error("Choose at least one category to erase.");
          return;
        }
        const { error } = await supabase.rpc("exercise_erasure", { _scope: scope });
        if (error) throw error;
        playSweep();
        toast.success("Erasure request filed with the DPO. Optical detections are now discarded.");
      } else {
        const { error } = await supabase.rpc("restore_consent");
        if (error) throw error;
        toast.success("Consent restored. Boundary detections will resume.");
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update consent");
    } finally {
      setBusy(false);
    }
  };

  const download = async (format: "json" | "pem") => {
    playClick();
    try {
      const cert = await getCert({ data: { format } });
      downloadText(cert.filename, cert.content, cert.mime);
    } catch {
      toast.error("Could not generate the certificate");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          playClick();
          setOpen(true);
        }}
        className="glass-btn"
      >
        <Fingerprint className="h-4 w-4" />
        DPDP Sec. 12 Vault
        {revoked && <span className="pill bg-warning-soft text-warning-strong">Revoked</span>}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="vault-title">
          <div className="mb-4 flex items-center justify-between">
            <h3 id="vault-title" className="text-lg font-semibold text-umbra">
              DPDP Sec. 12 — Data Empowerment
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sage transition hover:text-umbra"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-4 rounded-xl bg-muted p-4">
            <h4 className="mb-2 text-sm font-semibold text-umbra">
              Processing purpose (DPDP Sec. 6)
            </h4>
            <p className="text-xs leading-relaxed text-sage">
              PresenceTrack passively records workplace boundary crossings via ESP32-CAM sensors.
              Facial embeddings are extracted ephemerally, compared against your enrolled template
              and zeroized before retention. Raw video is{" "}
              <strong className="text-umbra">never recorded</strong>. Only match outcomes and dwell
              metrics are kept.
            </p>
          </div>

          <div className="mb-4 rounded-xl bg-muted p-4 text-xs text-sage">
            <h4 className="mb-3 text-sm font-semibold text-umbra">Enrolled vector template</h4>
            <div className="space-y-2">
              <Row label="Dimensions" value={embedding ? "512-D L2-normalized" : "Not enrolled"} />
              <Row
                label="Enrollment date"
                value={embedding?.enrolledAt ? embedding.enrolledAt.slice(0, 10) : "—"}
              />
              <Row label="Badge" value={profile.badge_id} />
              <Row label="Processing state" value={revoked ? "REVOKED" : "ACTIVE"} />
            </div>
          </div>

          {!revoked && (
            <fieldset className="mb-3 space-y-2">
              <legend className="stat-card-label mb-2">Erase on revocation</legend>
              {SCOPES.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-umbra">
                  <input
                    type="checkbox"
                    checked={scope.includes(s.id)}
                    onChange={(e) =>
                      setScope((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
            <span className="text-sm text-umbra">
              {revoked
                ? "Revocation exercised — no further optical detections are processed"
                : "Exercise right to erasure (revoke biometric processing)"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={revoked}
              aria-label="Revoke consent"
              onClick={toggle}
              disabled={busy}
              className={cn(
                "relative h-6 w-12 shrink-0 rounded-full transition disabled:opacity-50",
                revoked ? "bg-warning" : "bg-success",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 h-4 w-4 rounded-full bg-card transition-transform",
                  revoked && "translate-x-6",
                )}
              />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => download("json")} className="glass-btn">
              <Download className="h-4 w-4" /> Audit certificate (JSON)
            </button>
            <button type="button" onClick={() => download("pem")} className="glass-btn">
              <Download className="h-4 w-4" /> Certificate (PEM)
            </button>
          </div>

          {requests.length > 0 && (
            <div className="mt-4">
              <p className="stat-card-label mb-2">Your erasure requests</p>
              <ul className="space-y-1">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between rounded-lg bg-muted px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-sage">
                      {new Date(r.submitted_at).toLocaleDateString("en-IN")}
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        r.status === "VERIFIED_PURGED"
                          ? "text-success-strong"
                          : "text-warning-strong",
                      )}
                    >
                      {r.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="mt-4 list-inside list-disc space-y-1 text-xs text-sage">
            <li>Biometric template: zeroized when the DPO approves erasure</li>
            <li>Dwell records: retained per statutory audit requirements unless included above</li>
            <li>Video footage: never recorded</li>
            <li>Vector hashes: SHA-256 Merkle-anchored</li>
          </ul>
        </Modal>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono text-umbra">{value}</span>
    </div>
  );
}
