import { useState } from "react";
import { List, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { isNodeLive, ZONE_LABELS, ZONES, type Esp32Node, type ZoneType } from "@/lib/ambient";
import { playClick } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/presence/layout/Modal";

const NodeSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Node ID is required")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _"),
  stream_url: z.string().trim().url("Enter a full stream URL").max(300),
  boundary_name: z.string().trim().max(120),
  fps: z.number().min(1).max(60),
});

interface CameraConfigModalProps {
  open: boolean;
  onClose: () => void;
  nodes: Esp32Node[];
  onChanged: () => void;
}

/** Add/update ESP32-CAM IP addresses and boundary zones. */
export function CameraConfigModal({ open, onClose, nodes, onChanged }: CameraConfigModalProps) {
  const [tab, setTab] = useState<"add" | "list">("add");
  const [form, setForm] = useState({
    id: "",
    stream_url: "",
    boundary_name: "",
    zone_a: "WORKSPACE_FLOOR" as ZoneType,
    zone_b: "CORRIDOR_TRANSIT" as ZoneType,
    fps: 15,
  });
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const save = async () => {
    const parsed = NodeSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the node details");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("esp32_camera_nodes").upsert({
      ...parsed.data,
      boundary_name: parsed.data.boundary_name || `ESP32-CAM-${parsed.data.id}`,
      zone_a: form.zone_a,
      zone_b: form.zone_b,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save the node");
      return;
    }
    playClick();
    toast.success(`Node ${parsed.data.id} saved`);
    setForm({
      id: "",
      stream_url: "",
      boundary_name: "",
      zone_a: "WORKSPACE_FLOOR",
      zone_b: "CORRIDOR_TRANSIT",
      fps: 15,
    });
    setTab("list");
    onChanged();
  };

  const remove = async (id: string) => {
    if (!window.confirm(`Remove node ${id}? Its past transits are kept.`)) return;
    const { error } = await supabase.from("esp32_camera_nodes").delete().eq("id", id);
    if (error) {
      toast.error("Could not remove the node");
      return;
    }
    toast.success(`Node ${id} removed`);
    onChanged();
  };

  return (
    <Modal onClose={onClose} labelledBy="cam-title">
      <div className="mb-4 flex items-center justify-between">
        <h3 id="cam-title" className="text-lg font-semibold text-umbra">
          ESP32-CAM node configuration
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sage transition hover:text-umbra"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("add")}
          className={cn(tab === "add" ? "glass-btn-primary" : "glass-btn")}
        >
          <Plus className="h-4 w-4" /> Add node
        </button>
        <button
          type="button"
          onClick={() => setTab("list")}
          className={cn(tab === "list" ? "glass-btn-primary" : "glass-btn")}
        >
          <List className="h-4 w-4" /> Node list
        </button>
      </div>

      {tab === "add" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              placeholder="Node ID (e.g. ESP32-CAM-05-WEST)"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              className="glass-input"
            />
            <input
              placeholder="Stream URL (http://192.168.1.155:81/stream)"
              value={form.stream_url}
              onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
              className="glass-input"
            />
            <input
              placeholder="Boundary name"
              value={form.boundary_name}
              onChange={(e) => setForm({ ...form, boundary_name: e.target.value })}
              className="glass-input"
            />
            <input
              type="number"
              step="0.5"
              min={1}
              max={60}
              placeholder="FPS"
              value={form.fps}
              onChange={(e) => setForm({ ...form, fps: parseFloat(e.target.value) || 15 })}
              className="glass-input"
            />
            <label className="text-xs text-sage">
              Zone A
              <select
                value={form.zone_a}
                onChange={(e) => setForm({ ...form, zone_a: e.target.value as ZoneType })}
                className="glass-input mt-1 w-full"
              >
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABELS[z]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-sage">
              Zone B
              <select
                value={form.zone_b}
                onChange={(e) => setForm({ ...form, zone_b: e.target.value as ZoneType })}
                className="glass-input mt-1 w-full"
              >
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABELS[z]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !form.id || !form.stream_url}
              className="glass-btn-primary flex-1"
            >
              {saving ? "Saving…" : "Save node"}
            </button>
            <button type="button" onClick={() => setTab("list")} className="glass-btn">
              Cancel
            </button>
          </div>
          <p className="text-xxs text-sage">
            Nodes running the PresenceTrack firmware also register themselves automatically on boot.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.length === 0 && <p className="text-sm text-sage">No nodes registered.</p>}
          {nodes.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between rounded-lg bg-muted p-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-umbra">{node.id}</div>
                <div className="truncate text-xxs text-sage">{node.boundary_name}</div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    isNodeLive(node) ? "text-success-strong" : "text-warning-strong",
                  )}
                >
                  {isNodeLive(node) ? "ONLINE" : "OFFLINE"}
                </span>
                <button
                  type="button"
                  onClick={() => remove(node.id)}
                  className="text-sage transition hover:text-destructive"
                  aria-label={`Remove ${node.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
