import type { ReactNode } from "react";
import { APP_CONFIG } from "@/lib/ambient";
import { BrandMark } from "./BrandMark";

/** Split-screen access layout: statutory branding on the left, form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="ambient-orb top-20 left-10 h-[24rem] w-[24rem] bg-penna/40 blur-[100px]" />
          <div
            className="ambient-orb bottom-20 right-10 h-[20rem] w-[20rem] bg-hudson/50 blur-[90px]"
            style={{ animationDuration: "52s" }}
          />
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-umbra">
              PRESENCETRACK <span className="text-emerald-500">AI</span>
            </h1>
            <p className="text-sm text-sage">
              {APP_CONFIG.appVersion} · {APP_CONFIG.dpdpStandard}
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-xl animate-fade-in">
          <h2 className="mb-4 text-4xl font-bold leading-tight text-umbra">
            Presence, measured.
            <br />
            Privacy, preserved.
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-sage">
            Ambient biometric presence analytics built for the DPDP Act 2023. Zero video recording.
            Ephemeral 512-D vector extraction. Continuous boundary monitoring.
          </p>
          <div className="rounded-xl bg-muted p-4">
            <p className="text-xs leading-relaxed text-sage">
              <span className="font-semibold text-umbra">DPDP Act 2023 Statutory Notice: </span>
              PresenceTrack AI uses passive optical boundary sensors (ESP32-CAM) to detect presence.
              Facial embeddings are extracted ephemerally, matched against enrolled templates and
              zeroized (target under 18ms) before retention. Raw video is never recorded. Only match
              outcomes and dwell metrics are persisted.
            </p>
          </div>
        </div>

        <p className="relative z-10 text-xs text-sage">
          v1.0.0-PROD · Certified: DPDP 2023 · CERT-In · OSH Code
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
