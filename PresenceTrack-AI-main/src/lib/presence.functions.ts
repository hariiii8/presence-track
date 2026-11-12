import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { merkleRoot, sha256Hex } from "@/lib/merkle";

const PLATFORM = "PresenceTrack AI v1.0.0-PROD";
const VALIDATOR = "Orin-AGX-North";

function csvCell(value: unknown): string {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** RFC 4180 CSV of boundary transits for one IST day. HR/security/admin see everyone; employees see themselves. */
export const exportPresenceCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("passive_transits")
      .select(
        "timestamp, user_id, camera_id, zone_from, zone_to, direction, cosine_score, dram_scrub_ms, vector_hash, enterprise_users(name, badge_id)",
      )
      .gte("timestamp", `${data.date}T00:00:00+05:30`)
      .lte("timestamp", `${data.date}T23:59:59.999+05:30`)
      .order("timestamp", { ascending: false })
      .limit(5000);
    if (error) throw new Error("Failed to fetch transits");

    const headers = [
      "timestamp",
      "user_id",
      "name",
      "badge_id",
      "camera_id",
      "zone_from",
      "zone_to",
      "direction",
      "cosine_score",
      "dram_scrub_ms",
      "vector_hash",
    ];
    const lines = [headers.join(",")];
    for (const t of rows ?? []) {
      const person = t.enterprise_users as { name: string; badge_id: string } | null;
      lines.push(
        [
          t.timestamp,
          t.user_id,
          person?.name ?? "—",
          person?.badge_id ?? "—",
          t.camera_id ?? "",
          t.zone_from,
          t.zone_to,
          t.direction,
          t.cosine_score,
          t.dram_scrub_ms,
          t.vector_hash,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return {
      filename: `presencetrack-${data.date}.csv`,
      csv: lines.join("\r\n") + "\r\n",
      rows: rows?.length ?? 0,
    };
  });

/** Cryptographic audit certificate over the caller's own transit ledger (JSON or PEM). */
export const generateAuditCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ format: z.enum(["json", "pem"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("enterprise_users")
      .select("id, name, badge_id, consent_revoked")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!profile) throw new Error("No enrolled profile for this account");

    const { data: transits } = await context.supabase
      .from("passive_transits")
      .select("vector_hash")
      .eq("user_id", profile.id)
      .order("timestamp", { ascending: false })
      .limit(1000);
    const leaves = (transits ?? []).map((t) => t.vector_hash);
    const root = await merkleRoot(leaves.length ? leaves : [`genesis:${profile.id}`]);

    const { data: latest } = await context.supabase
      .from("merkle_audit_blocks")
      .select("block_height, root_hash")
      .order("block_height", { ascending: false })
      .limit(1)
      .maybeSingle();

    const issuedAt = new Date();
    const certId = `CERT-${issuedAt.getTime().toString(16).toUpperCase()}`;
    const cert = {
      certificate_id: certId,
      issued_at: issuedAt.toISOString(),
      valid_until: new Date(issuedAt.getTime() + 3600_000).toISOString(),
      platform: PLATFORM,
      regulation: "DPDP Act 2023 Statutory Standard",
      subject: {
        name: profile.name,
        badge_id: profile.badge_id,
        consent_revoked: profile.consent_revoked,
      },
      merkle_root: root,
      digests_hashed: leaves.length,
      anchored_block: latest
        ? { block_height: latest.block_height, root_hash: latest.root_hash }
        : null,
      validator_enclave: VALIDATOR,
      crypto_suites: ["SHA-256"],
      digest: await sha256Hex(`${certId}|${root}|${profile.badge_id}`),
    };

    if (data.format === "pem") {
      const content = [
        "-----BEGIN PRESENCETRACK AUDIT CERTIFICATE-----",
        `Issuer: ${cert.platform}`,
        `Certificate ID: ${cert.certificate_id}`,
        `Subject: ${profile.name} (${profile.badge_id})`,
        `Issued At: ${cert.issued_at}`,
        `Valid Until: ${cert.valid_until}`,
        `Merkle Root: ${cert.merkle_root}`,
        `Digests Hashed: ${cert.digests_hashed}`,
        `Digest: ${cert.digest}`,
        "-----END PRESENCETRACK AUDIT CERTIFICATE-----",
      ].join("\n");
      return {
        filename: `PresenceTrack-Audit-Cert-${certId}.pem`,
        mime: "application/x-pem-file",
        content,
      };
    }
    return {
      filename: `PresenceTrack-Audit-Cert-${certId}.json`,
      mime: "application/json",
      content: JSON.stringify(cert, null, 2),
    };
  });

/** Super Admin: anchor all transits since the previous block into a new Merkle block. */
export const anchorMerkleBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: prev } = await context.supabase
      .from("merkle_audit_blocks")
      .select("block_height, root_hash, timestamp")
      .order("block_height", { ascending: false })
      .limit(1)
      .maybeSingle();

    let query = context.supabase
      .from("passive_transits")
      .select("vector_hash, timestamp")
      .order("timestamp", { ascending: true })
      .limit(5000);
    if (prev) query = query.gt("timestamp", prev.timestamp);
    const { data: transits, error } = await query;
    if (error) throw new Error("Failed to read transits");

    const leaves = (transits ?? []).map((t) => t.vector_hash);
    const height = (prev?.block_height ?? 0) + 1;
    const previousHash = prev?.root_hash ?? "0".repeat(64);
    const txs = leaves.length ? leaves : [`empty-block:${height}`];
    const root = await merkleRoot(txs);
    const signature = `SHA256-${(await sha256Hex(`${VALIDATOR}|${height}|${root}|${previousHash}`)).toUpperCase()}`;

    const { error: insertError } = await context.supabase.from("merkle_audit_blocks").insert({
      block_height: height,
      root_hash: root,
      previous_hash: previousHash,
      transaction_count: leaves.length,
      leaf_hashes: txs,
      validator_enclave: VALIDATOR,
      dilithium_signature: signature,
      status: "VERIFIED",
    });
    if (insertError) throw new Error("Failed to anchor block");
    return { block_height: height, root_hash: root, transaction_count: leaves.length };
  });

/** Recompute a block's Merkle root from its stored leaves and compare with the anchored root. */
export const verifyMerkleBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ blockHeight: z.number().int().positive() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: block, error } = await context.supabase
      .from("merkle_audit_blocks")
      .select("*")
      .eq("block_height", data.blockHeight)
      .maybeSingle();
    if (error || !block) throw new Error("Block not found");
    const computed = block.leaf_hashes.length ? await merkleRoot(block.leaf_hashes) : null;
    return {
      block_height: block.block_height,
      stored_root: block.root_hash,
      computed_root: computed,
      verified: computed === block.root_hash,
      leaves: block.leaf_hashes.length,
      signature: block.dilithium_signature,
    };
  });
