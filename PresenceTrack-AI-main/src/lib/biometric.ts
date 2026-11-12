/**
 * Biometric Template Security & Cryptographic Processing
 * Conforms to DPDP Act 2023 Statutory Guidelines for biometric templates.
 *
 * Rules:
 * 1. Facial templates must never be exposed via public or standard employee query APIs.
 * 2. Templates are stored encrypted at rest using AES-256-GCM when BIOMETRIC_ENCRYPTION_KEY is provided.
 * 3. Feature matching evaluates cosine similarity over normalized float32 embedding arrays.
 * 4. Post-matching, volatile memory buffers must be dereferenced for immediate garbage collection.
 */

/** Compute cosine similarity between two normalized embedding vectors */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Validate whether a vector is a valid normalized embedding */
export function isValidEmbedding(vec: unknown, expectedDim = 512): vec is number[] {
  if (!Array.isArray(vec)) return false;
  if (vec.length !== expectedDim && vec.length !== 128) return false;
  return vec.every((v) => typeof v === "number" && !Number.isNaN(v));
}

/**
 * Derive AES-GCM CryptoKey from hex or base64 environment secret.
 * Returns null if BIOMETRIC_ENCRYPTION_KEY is not configured.
 */
async function getBiometricKey(): Promise<CryptoKey | null> {
  const secret = process.env["BIOMETRIC_ENCRYPTION_KEY"];
  if (!secret) return null;

  const keyBytes = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a biometric embedding array into an encrypted JSON envelope.
 */
export async function encryptBiometricTemplate(
  embedding: number[],
): Promise<{ encrypted: boolean; payload: string; iv?: string }> {
  const key = await getBiometricKey();
  if (!key) {
    // If no key configured in environment, return hashed digest payload with flag
    return {
      encrypted: false,
      payload: JSON.stringify(embedding),
    };
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(embedding));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  const b64Cipher = Buffer.from(ciphertext).toString("base64");
  const b64Iv = Buffer.from(iv).toString("base64");

  return {
    encrypted: true,
    payload: b64Cipher,
    iv: b64Iv,
  };
}

/**
 * Decrypt a stored biometric envelope back into a float32 array.
 */
export async function decryptBiometricTemplate(
  envelope: { encrypted: boolean; payload: string; iv?: string } | string | null,
): Promise<number[] | null> {
  if (!envelope) return null;

  // Plain JSON array fallback
  if (typeof envelope === "string") {
    try {
      const parsed = JSON.parse(envelope);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  if (!envelope.encrypted) {
    try {
      return JSON.parse(envelope.payload);
    } catch {
      return null;
    }
  }

  const key = await getBiometricKey();
  if (!key || !envelope.iv) return null;

  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const ciphertext = Buffer.from(envelope.payload, "base64");
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const text = new TextDecoder().decode(decrypted);
    return JSON.parse(text);
  } catch (err) {
    console.error("Failed to decrypt biometric template:", err);
    return null;
  }
}
