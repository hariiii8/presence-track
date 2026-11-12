import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Building2, Plus, Edit2, Save } from "lucide-react";
import { Modal } from "@/components/presence/layout/Modal";
import { listDepartments, createDepartment, updateDepartment } from "@/lib/employee.functions";
import type { Department } from "@/lib/ambient";

interface DepartmentManagerModalProps {
  onClose: () => void;
  onChanged: () => void;
}

export function DepartmentManagerModal({ onClose, onChanged }: DepartmentManagerModalProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listDepartments);
  const createFn = useServerFn(createDepartment);
  const updateFn = useServerFn(updateDepartment);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["departments"],
    queryFn: () => listFn(),
  });

  const departments = (data?.departments ?? []) as (Department & { employee_count?: number })[];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    try {
      const res = await createFn({
        data: {
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        },
      });

      if (res.success) {
        toast.success(`Department "${newName.trim()}" created`);
        setNewName("");
        setNewDesc("");
        await refetch();
        onChanged();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create department");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (d: Department) => {
    setEditingId(d.id);
    setEditName(d.name);
    setEditDesc(d.description ?? "");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;

    setSaving(true);
    try {
      const res = await updateFn({
        data: {
          id,
          name: editName.trim(),
          description: editDesc.trim() || null,
        },
      });

      if (res.success) {
        toast.success("Department updated");
        setEditingId(null);
        await refetch();
        onChanged();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update department");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="department-manager-title">
      <div className="p-6">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-soft text-success-strong">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 id="department-manager-title" className="text-base font-bold text-umbra">
                Department Management
              </h2>
              <p className="text-xxs text-sage">
                Organize organizational branches and workforce allocation
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

        {/* Create Department Form */}
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-xl border border-border/50 bg-muted/30 p-3.5"
        >
          <div className="text-xs font-semibold text-umbra mb-2 flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-success-strong" /> Add New Department
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Department Name (e.g. Legal & Compliance)"
              className="glass-input py-1.5 text-xs sm:col-span-1"
              disabled={creating}
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="glass-input py-1.5 text-xs sm:col-span-1"
              disabled={creating}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="glass-btn-primary py-1.5 text-xs"
            >
              {creating ? "Creating…" : "Create Department"}
            </button>
          </div>
        </form>

        {/* Existing Departments List */}
        <div className="mt-4 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-sage">Loading departments…</div>
          ) : departments.length === 0 ? (
            <div className="py-8 text-center text-xs text-sage">No departments configured.</div>
          ) : (
            <table className="table-glass text-xs">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Description</th>
                  <th>Allocated Staff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {editingId === d.id ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="glass-input py-1 text-xs font-semibold"
                        />
                      ) : (
                        <span className="font-semibold text-umbra">{d.name}</span>
                      )}
                    </td>
                    <td>
                      {editingId === d.id ? (
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="glass-input py-1 text-xs"
                          placeholder="Description"
                        />
                      ) : (
                        <span className="text-sage">{d.description || "—"}</span>
                      )}
                    </td>
                    <td>
                      <span className="pill bg-muted/60 text-xxs font-mono text-umbra">
                        {d.employee_count ?? 0} members
                      </span>
                    </td>
                    <td>
                      {editingId === d.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(d.id)}
                            disabled={saving}
                            className="glass-btn-primary py-1 px-2 text-xxs flex items-center gap-1"
                          >
                            <Save className="h-3 w-3" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="glass-btn py-1 px-2 text-xxs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="glass-btn py-1 px-2 text-xxs flex items-center gap-1"
                        >
                          <Edit2 className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="glass-btn py-1.5 text-xs">
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
