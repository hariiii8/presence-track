import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Anchor } from "lucide-react";
import { toast } from "sonner";
import { APP_CONFIG, isNodeLive, shortHash } from "@/lib/ambient";
import { canAccessEnclave, enclavePathFor } from "@/lib/enclaves";
import {
  erasureRequestsQuery,
  merkleBlocksQuery,
  nodesQuery,
  personnelQuery,
  recentTransitsQuery,
  rolesQuery,
} from "@/lib/queries";
import { anchorMerkleBlock, verifyMerkleBlock } from "@/lib/presence.functions";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { MerkleLedgerTable } from "@/components/presence/admin/MerkleLedgerTable";
import { HardwareNodeGrid } from "@/components/presence/admin/HardwareNodeGrid";
import { VectorRotationCard } from "@/components/presence/admin/VectorRotationCard";
import { DpoErasureQueue } from "@/components/presence/admin/DpoErasureQueue";
import { PersonnelRoles } from "@/components/presence/admin/PersonnelRoles";
import { AuditLogViewer } from "@/components/presence/admin/AuditLogViewer";
import { Esp32CanvasOverlay } from "@/components/presence/security/Esp32CanvasOverlay";
import { playClick } from "@/lib/sound-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/enclave/admin")({
  head: () => ({
    meta: [
      { title: "Governance Console — PresenceTrack AI" },
      {
        name: "description",
        content:
          "Merkle presence ledger, edge attestation, DPO erasure queue and enclave assignment.",
      },
      { property: "og:title", content: "Governance Console — PresenceTrack AI" },
      {
        property: "og:description",
        content:
          "Merkle presence ledger, edge attestation, DPO erasure queue and enclave assignment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!canAccessEnclave(context.role, "admin"))
      throw redirect({ to: enclavePathFor(context.role) });
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(nodesQuery()),
      context.queryClient.ensureQueryData(merkleBlocksQuery()),
      context.queryClient.ensureQueryData(erasureRequestsQuery()),
      context.queryClient.ensureQueryData(personnelQuery()),
      context.queryClient.ensureQueryData(rolesQuery()),
      context.queryClient.ensureQueryData(recentTransitsQuery()),
    ]);
  },
  component: AdminEnclave,
});

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function AdminEnclave() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: nodes } = useSuspenseQuery(nodesQuery());
  const { data: blocks } = useSuspenseQuery(merkleBlocksQuery());
  const { data: requests } = useSuspenseQuery(erasureRequestsQuery());
  const { data: people } = useSuspenseQuery(personnelQuery());
  const { data: roles } = useSuspenseQuery(rolesQuery());
  const { data: transits } = useSuspenseQuery(recentTransitsQuery());
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const anchor = useServerFn(anchorMerkleBlock);
  const verify = useServerFn(verifyMerkleBlock);

  useRealtimeRefresh("esp32_camera_nodes", [["nodes"]]);
  useRealtimeRefresh("merkle_audit_blocks", [["merkle-blocks"]]);
  useRealtimeRefresh("passive_transits", [["transits", "recent"]]);

  const inspectHeight = selectedHeight ?? blocks[0]?.block_height ?? null;
  const proof = useQuery({
    queryKey: ["merkle-proof", inspectHeight],
    queryFn: () => verify({ data: { blockHeight: inspectHeight! } }),
    enabled: inspectHeight !== null,
  });

  const p95 = percentile(
    transits.map((t) => Number(t.dram_scrub_ms)),
    95,
  );
  const live = nodes.filter((n) => isNodeLive(n)).length;
  const verifiedPct = blocks.length
    ? Math.round((blocks.filter((b) => b.status === "VERIFIED").length / blocks.length) * 100)
    : null;

  const handleAnchor = async () => {
    playClick();
    setAnchoring(true);
    try {
      const res = await anchor();
      toast.success(`Block #${res.block_height} anchored (${res.transaction_count} transits)`);
      setSelectedHeight(res.block_height);
      await queryClient.invalidateQueries({ queryKey: ["merkle-blocks"] });
    } catch {
      toast.error("Could not anchor a new block");
    } finally {
      setAnchoring(false);
    }
  };

  const refresh = (key: string) => () => queryClient.invalidateQueries({ queryKey: [key] });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="stat-card-label">Ephemeral DRAM zeroization (p95)</div>
          <div className="stat-card-value">{p95 === null ? "—" : `${p95}ms`}</div>
          <div className="text-xs text-sage">
            Target: &lt; {APP_CONFIG.dramTargetMs}ms{" "}
            {p95 !== null && (p95 < APP_CONFIG.dramTargetMs ? "PASS ✓" : "FAIL")}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Attested edge enclaves</div>
          <div className="stat-card-value">
            {live} / {nodes.length} online
          </div>
          <div className="text-xs text-sage">Heartbeat within the last minute</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Merkle block height</div>
          <div className="stat-card-value">#{blocks[0]?.block_height ?? 0}</div>
          <div className="text-xs text-sage">Anchoring boundary events</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">DPDP statutory audit status</div>
          <div className="stat-card-value">
            {verifiedPct === null ? "—" : `${verifiedPct}% attested`}
          </div>
          <div className="text-xs text-sage">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} on ledger
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-card">
          <h3 className="mb-3 text-sm font-semibold text-umbra">Live optical security matrix</h3>
          <Esp32CanvasOverlay
            isLive={live > 0}
            faceDetected={false}
            faceBoundingBox={null}
            scScore={0}
          />
          <div className="mt-2 font-mono text-xs text-sage">
            {live > 0 ? `${live} Node(s) Online` : "All Nodes Offline"} | Stream standby · Edge CV
            connects in Phase 5
          </div>
        </div>
        <div className="glass-card">
          <h3 className="mb-3 text-sm font-semibold text-umbra">
            Edge hardware enclave attestation
          </h3>
          <HardwareNodeGrid nodes={nodes} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-umbra">Merkle presence ledger</h3>
            <button
              type="button"
              onClick={handleAnchor}
              disabled={anchoring}
              className="glass-btn-primary px-3 py-1.5 text-xs"
            >
              <Anchor className="h-3.5 w-3.5" /> {anchoring ? "Anchoring…" : "Anchor new block"}
            </button>
          </div>
          <MerkleLedgerTable
            blocks={blocks}
            selectedHeight={inspectHeight}
            onSelect={(b) => setSelectedHeight(b.block_height)}
          />
        </div>
        <div className="glass-card">
          <DpoErasureQueue
            requests={requests}
            onChanged={() => {
              void refresh("erasure-requests")();
              void refresh("transits")();
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-card">
          <VectorRotationCard />
        </div>
        <div className="glass-card">
          <h3 className="mb-3 text-sm font-semibold text-umbra">Inclusion proof inspector</h3>
          {inspectHeight === null ? (
            <p className="text-sm text-sage">Anchor a block to inspect its proof.</p>
          ) : (
            <div className="space-y-3 rounded-xl bg-muted p-4 text-sm">
              <Row label="Block" value={`#${inspectHeight}`} />
              <Row
                label="Merkle root (computed)"
                value={
                  proof.data?.computed_root
                    ? shortHash(proof.data.computed_root)
                    : proof.isLoading
                      ? "computing…"
                      : "—"
                }
              />
              <Row
                label="Merkle root (stored)"
                value={proof.data ? shortHash(proof.data.stored_root) : "—"}
              />
              <Row label="Leaves" value={proof.data ? String(proof.data.leaves) : "—"} />
              <div className="flex justify-between">
                <span className="text-sage">Proof verified</span>
                <span
                  className={cn(
                    "font-semibold",
                    proof.data?.verified ? "text-success-strong" : "text-destructive",
                  )}
                >
                  {proof.isLoading ? "…" : proof.data?.verified ? "✓ VALID" : "✗ MISMATCH"}
                </span>
              </div>
              <Row label="Crypto suite" value="SHA-256 Merkle" />
            </div>
          )}
        </div>
      </div>

      <AuditLogViewer />

      <div className="glass-card">
        <PersonnelRoles
          people={people}
          roles={roles}
          selfAuthId={user.id}
          onChanged={() => void refresh("roles")()}
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sage">{label}</span>
      <span className="truncate font-mono text-umbra">{value}</span>
    </div>
  );
}
