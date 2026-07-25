/**
 * Unit tests for evidence storage adapter + integrity decision (SVC-103).
 *
 * Covers:
 *   • resolveStorageConfig — configured vs explicit not-configured
 *   • generatePresignedPutUrl — REAL AWS SigV4 signed URL (offline signing)
 *   • fetchObjectSha256 — recompute hash / null when not retrievable
 *   • decideIntegrity — valid / tampered / unverified (never always-valid)
 *
 * Validates: Requirements 7.4, 7.8
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  resolveStorageConfig,
  generatePresignedPutUrl,
  fetchObjectSha256,
  createS3Client,
  type StorageConfig,
} from "../src/modules/evidence/storage.js";
import { decideIntegrity } from "../src/modules/evidence/domain.js";

const FULL_ENV = {
  S3_BUCKET_NAME: "civitas-evidence",
  S3_REGION: "ap-south-1",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "secretkeyexample",
};

const CONFIG: StorageConfig = {
  bucket: "civitas-evidence",
  region: "ap-south-1",
  forcePathStyle: false,
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretkeyexample",
};

describe("resolveStorageConfig", () => {
  it("returns a complete config when bucket, region and credentials are present", () => {
    const cfg = resolveStorageConfig(FULL_ENV);
    expect(cfg).not.toBeNull();
    expect(cfg!.bucket).toBe("civitas-evidence");
    expect(cfg!.region).toBe("ap-south-1");
    expect(cfg!.accessKeyId).toBe("AKIAEXAMPLE");
  });

  it("returns null (explicit not-configured) when credentials are missing", () => {
    const cfg = resolveStorageConfig({ S3_BUCKET_NAME: "b", S3_REGION: "r" });
    expect(cfg).toBeNull();
  });

  it("returns null when bucket is missing", () => {
    const cfg = resolveStorageConfig({
      S3_REGION: "r",
      AWS_ACCESS_KEY_ID: "a",
      AWS_SECRET_ACCESS_KEY: "s",
    });
    expect(cfg).toBeNull();
  });

  it("returns null for an empty environment", () => {
    expect(resolveStorageConfig({})).toBeNull();
  });

  it("enables path-style addressing when a custom endpoint is set", () => {
    const cfg = resolveStorageConfig({ ...FULL_ENV, S3_ENDPOINT: "http://localhost:4566" });
    expect(cfg!.forcePathStyle).toBe(true);
    expect(cfg!.endpoint).toBe("http://localhost:4566");
  });

  it("carries a session token when provided", () => {
    const cfg = resolveStorageConfig({ ...FULL_ENV, AWS_SESSION_TOKEN: "tok" });
    expect(cfg!.sessionToken).toBe("tok");
  });
});

describe("generatePresignedPutUrl", () => {
  it("produces a REAL SigV4 presigned PUT URL (offline signing)", async () => {
    const url = await generatePresignedPutUrl(CONFIG, "evidence/t/i/e/photo.jpg", "image/jpeg", 900);
    // Real SigV4 markers — proves this is genuine signing, not a fabricated string.
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Credential=");
    expect(url).toContain("X-Amz-Expires=900");
    // Targets the correct bucket + key.
    expect(url).toContain("civitas-evidence");
    expect(url).toContain("evidence/t/i/e/photo.jpg");
  });

  it("honours a custom endpoint via an injected client", async () => {
    const cfg: StorageConfig = { ...CONFIG, endpoint: "http://localhost:4566", forcePathStyle: true };
    const client = createS3Client(cfg);
    const url = await generatePresignedPutUrl(cfg, "k/obj.png", "image/png", 300, client);
    expect(url).toContain("localhost:4566");
    expect(url).toContain("X-Amz-Signature=");
  });
});

describe("fetchObjectSha256", () => {
  it("recomputes the SHA-256 of the stored object bytes", async () => {
    const bytes = new TextEncoder().encode("hello evidence bytes");
    const expected = createHash("sha256").update(bytes).digest("hex");
    const fakeClient = {
      send: async () => ({ Body: { transformToByteArray: async () => bytes } }),
    } as unknown as ReturnType<typeof createS3Client>;

    const hash = await fetchObjectSha256(CONFIG, "k", fakeClient);
    expect(hash).toBe(expected);
  });

  it("returns null when the object is not retrievable (send throws)", async () => {
    const fakeClient = {
      send: async () => {
        throw new Error("NoSuchKey");
      },
    } as unknown as ReturnType<typeof createS3Client>;
    expect(await fetchObjectSha256(CONFIG, "missing", fakeClient)).toBeNull();
  });

  it("returns null when the response body is absent", async () => {
    const fakeClient = {
      send: async () => ({}),
    } as unknown as ReturnType<typeof createS3Client>;
    expect(await fetchObjectSha256(CONFIG, "k", fakeClient)).toBeNull();
  });
});

describe("decideIntegrity", () => {
  it("returns valid when stored and recomputed hashes match", () => {
    expect(decideIntegrity("abc123", "abc123")).toBe("valid");
  });

  it("returns tampered when hashes differ (NOT always-valid)", () => {
    expect(decideIntegrity("abc123", "def456")).toBe("tampered");
  });

  it("returns unverified when the recomputed hash is null (unconfigured/unretrievable)", () => {
    expect(decideIntegrity("abc123", null)).toBe("unverified");
  });

  it("returns unverified for an empty recomputed hash", () => {
    expect(decideIntegrity("abc123", "")).toBe("unverified");
  });

  it("never reports valid without a matching recomputed hash", () => {
    expect(decideIntegrity("abc123", undefined)).not.toBe("valid");
  });
});
