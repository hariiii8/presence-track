import { UserX } from "lucide-react";

/** Shown when a verified account could not be matched to exactly one enrolled profile. */
export function UnlinkedProfile() {
  return (
    <div className="glass-card mx-auto max-w-lg p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning-strong">
        <UserX className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-umbra">Profile not linked yet</h2>
      <p className="mt-2 text-sm text-sage">
        Your account is verified, but it isn't linked to a single enrolled personnel profile. Your
        Data Protection Officer can resolve this from the governance console.
      </p>
    </div>
  );
}
