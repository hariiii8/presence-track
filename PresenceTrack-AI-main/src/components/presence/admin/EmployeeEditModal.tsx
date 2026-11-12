import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, UserCheck, UserX, Save, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/presence/layout/Modal";
import { updateEmployee, deactivateEmployee } from "@/lib/employee.functions";
import { activateEmployee } from "@/lib/auth.functions";
import type { EnterpriseUser } from "@/lib/ambient";

interface EmployeeEditModalProps {
  employee: EnterpriseUser;
  departments: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function EmployeeEditModal({
  employee,
  departments,
  onClose,
  onSuccess,
}: EmployeeEditModalProps) {
  const updateFn = useServerFn(updateEmployee);
  const deactivateFn = useServerFn(deactivateEmployee);
  const activateFn = useServerFn(activateEmployee);

  const [name, setName] = useState(employee.name);
  const [badgeId, setBadgeId] = useState(employee.badge_id);
  const [department, setDepartment] = useState(employee.department ?? "General");
  const [roleTitle, setRoleTitle] = useState(employee.role_title ?? "Staff");
  const [shiftStart, setShiftStart] = useState(employee.shift_start ?? "09:00:00");
  const [shiftEnd, setShiftEnd] = useState(employee.shift_end ?? "18:00:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) return setError("Name is required");
    if (!badgeId.trim()) return setError("Badge ID is required");

    setLoading(true);
    try {
      const res = await updateFn({
        data: {
          id: employee.id,
          name: name.trim(),
          badge_id: badgeId.trim().toUpperCase(),
          department: department.trim(),
          role_title: roleTitle.trim(),
          shift_start: shiftStart.length === 5 ? `${shiftStart}:00` : shiftStart,
          shift_end: shiftEnd.length === 5 ? `${shiftEnd}:00` : shiftEnd,
        },
      });

      if (res.success) {
        toast.success("Employee record updated successfully");
        onSuccess();
        onClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update employee";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActiveState = async () => {
    setError("");
    setLoading(true);
    try {
      if (employee.is_active) {
        // Deactivate
        const res = await deactivateFn({
          data: {
            id: employee.id,
            reason: deactivateReason.trim() || "Administrative deactivation",
          },
        });
        if (res.success) {
          toast.success("Employee deactivated");
          onSuccess();
          onClose();
        }
      } else {
        // Activate
        const res = await activateFn({
          data: {
            employee_id: employee.id,
          },
        });
        if (res.success) {
          toast.success("Employee activated");
          onSuccess();
          onClose();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update active state";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setConfirmDeactivate(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="edit-employee-title">
      <div className="p-6">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div>
            <h2 id="edit-employee-title" className="text-base font-bold text-umbra">
              Edit Employee Profile
            </h2>
            <p className="text-xxs text-sage">
              Modify enterprise personnel details and operational shifts
            </p>
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

        {confirmDeactivate ? (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive-soft p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="flex-1 text-xs">
                <div className="font-bold text-destructive">Confirm Account Deactivation</div>
                <p className="mt-1 text-sage">
                  Deactivating <strong>{employee.name}</strong> will terminate any active
                  cryptographic sessions and block entry into all enclaves.
                </p>

                <div className="mt-3">
                  <label htmlFor="deact-reason" className="text-xxs text-sage mb-1 block">
                    Reason for deactivation:
                  </label>
                  <input
                    id="deact-reason"
                    type="text"
                    value={deactivateReason}
                    onChange={(e) => setDeactivateReason(e.target.value)}
                    placeholder="Departure, compliance hold, etc."
                    className="glass-input w-full py-1.5 text-xs"
                  />
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleActiveState}
                    disabled={loading}
                    className="glass-btn border-destructive bg-destructive text-primary-foreground py-1.5 text-xs"
                  >
                    {loading ? "Deactivating…" : "Yes, Deactivate Account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeactivate(false)}
                    className="glass-btn py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdate} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="emp-name" className="stat-card-label mb-1.5 block">
                  Full Name
                </label>
                <input
                  id="emp-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="glass-input w-full py-2 text-xs"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="emp-badge" className="stat-card-label mb-1.5 block">
                  Badge ID
                </label>
                <input
                  id="emp-badge"
                  required
                  value={badgeId}
                  onChange={(e) => setBadgeId(e.target.value)}
                  className="glass-input w-full font-mono py-2 text-xs"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="emp-dept" className="stat-card-label mb-1.5 block">
                  Department
                </label>
                <input
                  id="emp-dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  list="dept-options"
                  className="glass-input w-full py-2 text-xs"
                  disabled={loading}
                />
                <datalist id="dept-options">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="emp-role-title" className="stat-card-label mb-1.5 block">
                  Position / Role Title
                </label>
                <input
                  id="emp-role-title"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  className="glass-input w-full py-2 text-xs"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="emp-shift-start" className="stat-card-label mb-1.5 block">
                  Shift Start Time
                </label>
                <input
                  id="emp-shift-start"
                  type="time"
                  value={shiftStart.slice(0, 5)}
                  onChange={(e) => setShiftStart(e.target.value)}
                  className="glass-input w-full py-2 text-xs font-mono"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="emp-shift-end" className="stat-card-label mb-1.5 block">
                  Shift End Time
                </label>
                <input
                  id="emp-shift-end"
                  type="time"
                  value={shiftEnd.slice(0, 5)}
                  onChange={(e) => setShiftEnd(e.target.value)}
                  className="glass-input w-full py-2 text-xs font-mono"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center">
              <div>
                {employee.is_active ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeactivate(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-destructive hover:underline"
                  >
                    <UserX className="h-4 w-4" /> Deactivate Account
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleToggleActiveState}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-xs font-semibold text-success-strong hover:underline"
                  >
                    <UserCheck className="h-4 w-4" /> Reactivate Account
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="glass-btn py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="glass-btn-primary flex items-center gap-1.5 py-2 text-xs"
                >
                  <Save className="h-3.5 w-3.5" />
                  {loading ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
