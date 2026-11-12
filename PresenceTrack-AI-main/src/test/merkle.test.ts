import { describe, expect, it } from "vitest";
import { merkleProof, merkleRoot, sha256Hex, verifyMerkleProof } from "@/lib/merkle";

describe("merkle cryptographic tree", () => {
  it("computes deterministic sha256Hex", async () => {
    const hash = await sha256Hex("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("throws when constructing with empty transactions", async () => {
    await expect(merkleRoot([])).rejects.toThrow(
      "Cannot construct Merkle tree with zero transactions",
    );
    await expect(merkleProof([], 0)).rejects.toThrow(
      "Cannot construct Merkle tree with zero transactions",
    );
  });

  it("handles a single transaction tree", async () => {
    const tx = "single-tx";
    const root = await merkleRoot([tx]);
    const expected = await sha256Hex(tx);
    expect(root).toBe(expected);

    const proof = await merkleProof([tx], 0);
    expect(proof).toHaveLength(0);
    expect(await verifyMerkleProof(tx, proof, root)).toBe(true);
    expect(await verifyMerkleProof("tampered", proof, root)).toBe(false);
  });

  it("throws on out-of-bounds indices", async () => {
    const txs = ["tx1", "tx2"];
    await expect(merkleProof(txs, -1)).rejects.toThrow("Index -1 out of bounds");
    await expect(merkleProof(txs, 2)).rejects.toThrow("Index 2 out of bounds");
  });

  it("verifies trees with even numbers of leaves", async () => {
    const txs = ["t1", "t2", "t3", "t4"];
    const root = await merkleRoot(txs);
    for (let i = 0; i < txs.length; i++) {
      const proof = await merkleProof(txs, i);
      expect(await verifyMerkleProof(txs[i]!, proof, root)).toBe(true);
    }
  });

  it("verifies trees with odd numbers of leaves", async () => {
    const txs = ["t1", "t2", "t3"];
    const root = await merkleRoot(txs);
    for (let i = 0; i < txs.length; i++) {
      const proof = await merkleProof(txs, i);
      expect(await verifyMerkleProof(txs[i]!, proof, root)).toBe(true);
    }
  });
});
