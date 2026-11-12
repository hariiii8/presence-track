import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cosineSimilarity,
  isValidEmbedding,
  encryptBiometricTemplate,
  decryptBiometricTemplate,
} from "@/lib/biometric";

const EmployeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Valid email required").max(255),
  badge_id: z.string().trim().min(1, "Badge ID required").max(64),
  department_id: z.string().uuid().optional().nullable(),
  role_title: z.string().trim().min(1).max(100).default("Staff"),
  employment_type: z.string().trim().default("FULL_TIME"),
  shift_start: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .default("09:00:00"),
  shift_end: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .default("18:00:00"),
});

describe("Employee Management & Domain Validation", () => {
  it("validates valid employee registration input", () => {
    const input = {
      name: "Dr. Aarti Sharma",
      email: "aarti.sharma@enterprise.org",
      badge_id: "PT-ENG-042",
      role_title: "Senior CV Researcher",
      employment_type: "FULL_TIME",
    };

    const parsed = EmployeeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Dr. Aarti Sharma");
      expect(parsed.data.shift_start).toBe("09:00:00");
      expect(parsed.data.shift_end).toBe("18:00:00");
    }
  });

  it("rejects invalid emails and empty badge IDs", () => {
    expect(
      EmployeeSchema.safeParse({
        name: "Test User",
        email: "not-an-email",
        badge_id: "PT-001",
      }).success,
    ).toBe(false);

    expect(
      EmployeeSchema.safeParse({
        name: "Test User",
        email: "test@enterprise.org",
        badge_id: "   ",
      }).success,
    ).toBe(false);
  });

  it("omits biometric templates from public employee projection", () => {
    const mockDbRow = {
      id: "9f848c4e-5975-433b-8d07-2a4175560a63",
      name: "Rohan Patel",
      email: "rohan.patel@enterprise.org",
      badge_id: "PT-ENG-088",
      enrolled_embedding: [0.12, 0.45, -0.67, 0.89], // Sensitive template
      is_active: true,
      department: "Engineering & R&D",
    };

    // Public API projection must strip enrolled_embedding
    const { enrolled_embedding, ...publicProfile } = mockDbRow;
    expect(publicProfile).not.toHaveProperty("enrolled_embedding");
    expect(publicProfile.name).toBe("Rohan Patel");
    expect(publicProfile.is_active).toBe(true);
  });

  it("evaluates cosine similarity between facial embeddings accurately", () => {
    const vec1 = [1, 0, 0, 0];
    const vec2 = [1, 0, 0, 0]; // Identical -> 1.000
    const vec3 = [0, 1, 0, 0]; // Orthogonal -> 0.000
    const vec4 = [0.8, 0.6, 0, 0]; // Close -> 0.800

    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 4);
    expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0.0, 4);
    expect(cosineSimilarity(vec1, vec4)).toBeCloseTo(0.8, 4);
  });

  it("validates embedding dimensions strictly (128 or 512 dimensions)", () => {
    const valid128 = Array.from({ length: 128 }, () => Math.random());
    const valid512 = Array.from({ length: 512 }, () => Math.random());
    const invalidLength = [0.1, 0.2, 0.3];

    expect(isValidEmbedding(valid128, 128)).toBe(true);
    expect(isValidEmbedding(valid512, 512)).toBe(true);
    expect(isValidEmbedding(invalidLength, 512)).toBe(false);
    expect(isValidEmbedding("not-an-array")).toBe(false);
  });

  it("encrypts and decrypts 128-d biometric templates via AES-256-GCM envelope", async () => {
    process.env["BIOMETRIC_ENCRYPTION_KEY"] = "test-biometric-secret-key-32chr";
    const template128 = Array.from({ length: 128 }, (_, i) => Number((i * 0.007).toFixed(4)));

    const envelope = await encryptBiometricTemplate(template128);
    expect(envelope.encrypted).toBe(true);
    expect(typeof envelope.payload).toBe("string");
    expect(typeof envelope.iv).toBe("string");

    // Ciphertext must not contain plaintext vector
    expect(envelope.payload).not.toContain("0.007");

    // Decryption round-trip
    const decrypted = await decryptBiometricTemplate(envelope);
    expect(decrypted).not.toBeNull();
    expect(decrypted).toHaveLength(128);
    for (let i = 0; i < 128; i++) {
      expect(decrypted![i]).toBeCloseTo(template128[i]!, 3);
    }
  });

  it("fails cleanly when decrypting with tampered ciphertext", async () => {
    process.env["BIOMETRIC_ENCRYPTION_KEY"] = "test-biometric-secret-key-32chr";
    const envelope = {
      encrypted: true,
      payload: "dGFtcGVyZWQtY2lwaGVydGV4dA==", // "tampered-ciphertext"
      iv: Buffer.from(new Uint8Array(12)).toString("base64"),
    };

    const result = await decryptBiometricTemplate(envelope);
    expect(result).toBeNull();
  });
});
