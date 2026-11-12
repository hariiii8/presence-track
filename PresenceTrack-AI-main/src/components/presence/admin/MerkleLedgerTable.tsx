import { shortHash, type MerkleAuditBlock } from "@/lib/ambient";
import { cn } from "@/lib/utils";

interface MerkleLedgerTableProps {
  blocks: MerkleAuditBlock[];
  selectedHeight: number | null;
  onSelect: (block: MerkleAuditBlock) => void;
}

/** Block height table with root hashes. */
export function MerkleLedgerTable({ blocks, selectedHeight, onSelect }: MerkleLedgerTableProps) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-xl bg-muted p-6 text-center text-sm text-sage">
        No Merkle blocks anchored yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-glass">
        <thead>
          <tr>
            <th>Block #</th>
            <th>Timestamp</th>
            <th>Root hash</th>
            <th>Txns</th>
            <th>Validator</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr
              key={b.block_height}
              onClick={() => onSelect(b)}
              className={cn(
                "cursor-pointer transition hover:bg-muted",
                selectedHeight === b.block_height && "bg-success-soft",
              )}
            >
              <td className="font-mono text-xs text-umbra">#{b.block_height}</td>
              <td className="font-mono text-xs text-sage">
                {new Date(b.timestamp).toLocaleString("en-IN", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </td>
              <td className="font-mono text-xs text-sage">{shortHash(b.root_hash)}</td>
              <td className="text-xs text-umbra">{b.transaction_count}</td>
              <td className="text-xs text-umbra">{b.validator_enclave}</td>
              <td>
                <span className="pill border-border bg-muted text-umbra">{b.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
