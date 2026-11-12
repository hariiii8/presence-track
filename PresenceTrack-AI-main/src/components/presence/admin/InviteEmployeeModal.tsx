import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, X, Shield, Mail, BadgeCheck, Briefcase } from "lucide-react";
import { Modal } from "@/components/presence/layout/Modal";
import { inviteEmployee } from "@/lib/auth.functions";
import { ROLE_LABELS, type UserRole } from "@/lib/ambient";

interface InviteEmployeeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const ROLES: UserRole[] = ["employee", "hr_ops", "security", "super_admin"];

export function InviteEmployeeModal({ onClose, onSuccess }: InviteEmployeeModalProps) {
  const invite = useServerFn(inviteEmployee);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [badgeId, setBadgeId] = useState(() => `PT-${Math.floor(1000 + Math.random() * 9000)}`);
  const [department, setDepartment] = useState("Engineering");
  const [role, setRole] = useState<UserRole>("employee");
  const [roleTitle, setRoleTitle] = useState("Staff Member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) return setError("Name is required");
    if (!email.trim() || !email.includes("@")) return setError("Valid corporate email is required");
    if (!badgeId.trim()) return setError("Badge ID is required");

    setLoading(true);
    try {
      const res = await invite({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          badge_id: badgeId.trim().toUpperCase(),
          department: department.trim() || "General",
          role,
          role_title: roleTitle.trim() || "Staff",
        },
      });

      if (res.success) {
        toast.success(res.message);
        onSuccess();
        onClose();
      } else {
        setError("Failed to dispatch invitation.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to invite employee";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="invite-employee-title">
      <div className="p-6">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-soft text-success-strong">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 id="invite-employee-title" className="text-base font-bold text-umbra">
                Onboard Personnel
              </h2>
              <p className="text-xxs text-sage">
                Issue DPDP statutory access invitation & link corporate credentials
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-sage hover:bg-muted hover:text-umbra"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-name" className="stat-card-label mb-1.5 block">
                Full Name
              </label>
              <input
                id="inv-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Maya Patel"
                className="glass-input w-full py-2 text-xs"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="inv-email" className="stat-card-label mb-1.5 block">
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Corporate Email
                </span>
              </label>
              <input
                id="inv-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maya.patel@presencetrack.corp"
                className="glass-input w-full py-2 text-xs"
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-badge" className="stat-card-label mb-1.5 block">
                <span className="flex items-center gap-1">
                  <BadgeCheck className="h-3 w-3" /> Badge ID / Staff ID
                </span>
              </label>
              <input
                id="inv-badge"
                required
                value={badgeId}
                onChange={(e) => setBadgeId(e.target.value)}
                placeholder="PT-4021"
                className="glass-input w-full font-mono py-2 text-xs"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="inv-dept" className="stat-card-label mb-1.5 block">
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> Department
                </span>
              </label>
              <input
                id="inv-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Operations, Engineering..."
                className="glass-input w-full py-2 text-xs"
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-role" className="stat-card-label mb-1.5 block">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Enclave Authorization
                </span>
              </label>
              <select
                id="inv-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="glass-input w-full py-2 text-xs"
                disabled={loading}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="inv-title" className="stat-card-label mb-1.5 block">
                Position Title
              </label>
              <input
                id="inv-title"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Software Engineer, HR Lead..."
                className="glass-input w-full py-2 text-xs"
                disabled={loading}
              />
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 p-3 text-xxs leading-relaxed text-sage">
            Upon dispatch, Supabase Auth sends a statutory invitation containing a cryptographic
            token. The user will establish their passcode and their profile is tied via the verified
            corporate email.
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="glass-btn py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="glass-btn-primary py-2 text-xs">
              {loading ? "Dispatching Invitation…" : "Dispatch Enclave Invitation"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
