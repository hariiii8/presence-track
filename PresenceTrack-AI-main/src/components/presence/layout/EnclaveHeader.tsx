import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { APP_CONFIG, ROLE_LABELS, type UserRole } from "@/lib/ambient";
import { playClick } from "@/lib/sound-engine";
import { BrandMark } from "./BrandMark";

interface EnclaveHeaderProps {
  name: string;
  badgeId: string;
  avatarUrl: string | null;
  role: UserRole | null;
  onSignOut: () => void;
}

export function EnclaveHeader({ name, badgeId, avatarUrl, role, onSignOut }: EnclaveHeaderProps) {
  const [veiled, setVeiled] = useState(false);

  // Anti-shoulder-surfing: blur the console whenever the tab is hidden.
  useEffect(() => {
    const onVisibility = () => setVeiled(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-glass backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <div>
              <h1 className="text-sm font-extrabold tracking-tight text-umbra">
                PRESENCETRACK <span className="text-emerald-500">AI</span>
              </h1>
              <p className="hidden text-xs text-sage sm:block">
                {APP_CONFIG.appVersion} — {APP_CONFIG.dpdpStandard}
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 md:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            <span className="text-xs text-sage">
              {role ? ROLE_LABELS[role] : "Enclave"} enclave
            </span>
            <span className="ml-2 text-xs font-medium text-success-strong">Sealed session</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name}
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-umbra/20"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success text-xs font-bold text-primary-foreground">
                  {initials}
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-xs font-medium text-umbra">{name}</p>
                <p className="text-xxs font-mono text-sage">{badgeId}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                playClick();
                onSignOut();
              }}
              className="umbra-btn"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>
      {veiled && <div className="privacy-veil" aria-hidden="true" />}
    </>
  );
}
