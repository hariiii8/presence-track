/**
 * SHA-256 Merkle tree over transit vector hashes (Web Crypto — runs in the browser and on the server).
 * Odd nodes are paired with themselves, matching the original ledger implementation.
 */

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildMerkleLevels(transactions: string[]): Promise<string[][]> {
  if (transactions.length === 0)
    throw new Error("Cannot construct Merkle tree with zero transactions");
  const leaves = await Promise.all(transactions.map((t) => sha256Hex(t)));
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1] ?? left;
      next.push(await sha256Hex(left + right));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

export async function merkleRoot(transactions: string[]): Promise<string> {
  const levels = await buildMerkleLevels(transactions);
  return levels[levels.length - 1]![0]!;
}

export type ProofStep = { hash: string; position: "left" | "right" };

export async function merkleProof(transactions: string[], index: number): Promise<ProofStep[]> {
  const levels = await buildMerkleLevels(transactions);
  if (index < 0 || index >= levels[0]!.length) throw new Error(`Index ${index} out of bounds`);
  const proof: ProofStep[] = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const nodes = levels[level]!;
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    proof.push({ hash: nodes[siblingIdx] ?? nodes[idx]!, position: isRight ? "left" : "right" });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export async function verifyMerkleProof(
  transaction: string,
  proof: ProofStep[],
  root: string,
): Promise<boolean> {
  let hash = await sha256Hex(transaction);
  for (const step of proof) {
    hash =
      step.position === "left"
        ? await sha256Hex(step.hash + hash)
        : await sha256Hex(hash + step.hash);
  }
  return hash === root;
}
