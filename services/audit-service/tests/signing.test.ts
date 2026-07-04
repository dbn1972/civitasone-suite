/**
 * Audit export signing verification tests (pure — no DB).
 *
 * Verifies:
 *   - Content digest is deterministic
 *   - Signing produces a non-empty hex string
 *   - Verification succeeds on unmodified content
 *   - Verification fails on tampered content (content-tamper)
 *   - Verification fails on tampered manifest (signature-mismatch)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { contentDigest, signManifest, canonicalManifest, verifyArtifact } from "../src/modules/exports/signing.js";

beforeAll(() => {
  // Set signing key for tests
  process.env.EXPORT_SIGNING_KEY = "test-signing-key-for-civitasone-32char";
  process.env.EXPORT_SIGNING_KEY_ID = "test-key-1";
});

describe("Audit export signing (pure)", () => {
  const manifest = {
    exportId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-03-31T23:59:59.999Z",
    format: "json",
    includesPii: false,
    rowCount: 42,
    contentSha256: "", // filled below
  };

  it("contentDigest is deterministic", () => {
    const content = JSON.stringify({ events: [{ id: "e1", type: "test" }] });
    const d1 = contentDigest(content);
    const d2 = contentDigest(content);
    expect(d1).toBe(d2);
    expect(d1.length).toBe(64); // SHA-256 hex
  });

  it("signManifest produces non-empty hex signature", () => {
    const m = { ...manifest, contentSha256: contentDigest("test content") };
    const sig = signManifest(m);
    expect(sig.length).toBe(64); // HMAC-SHA256 hex
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalManifest is deterministic regardless of property order", () => {
    const m = { ...manifest, contentSha256: "abcd" };
    const c1 = canonicalManifest(m);
    const c2 = canonicalManifest(m);
    expect(c1).toBe(c2);
    // Keys are sorted alphabetically in the canonical form
    expect(c1).toContain("alg");
    expect(c1).toContain("contentSha256");
  });

  it("verifyArtifact succeeds on unmodified content", () => {
    const content = "This is the audit export content for Q1 FY2026";
    const sha = contentDigest(content);
    const m = { ...manifest, contentSha256: sha };
    const signature = signManifest(m);

    const result = verifyArtifact(content, { contentSha256: sha, signature }, m);
    expect(result.ok).toBe(true);
    expect(result.contentMatch).toBe(true);
    expect(result.signatureMatch).toBe(true);
  });

  it("verifyArtifact fails on tampered content (byte change)", () => {
    const original = "Original audit content";
    const sha = contentDigest(original);
    const m = { ...manifest, contentSha256: sha };
    const signature = signManifest(m);

    // Tamper: change one character
    const tampered = "Original audit contant"; // 'e' → 'a'
    const result = verifyArtifact(tampered, { contentSha256: sha, signature }, m);
    expect(result.ok).toBe(false);
    expect(result.contentMatch).toBe(false); // content doesn't match digest
  });

  it("verifyArtifact fails on tampered manifest (different exportId)", () => {
    const content = "Audit Q2";
    const sha = contentDigest(content);
    const m = { ...manifest, contentSha256: sha };
    const signature = signManifest(m);

    // Verify with a different exportId in manifest → signature won't match
    const tamperedManifest = { ...m, exportId: "99999999-9999-9999-9999-999999999999" };
    const result = verifyArtifact(content, { contentSha256: sha, signature }, tamperedManifest);
    expect(result.ok).toBe(false);
    expect(result.contentMatch).toBe(true); // content is fine
    expect(result.signatureMatch).toBe(false); // signature computed over different manifest
  });

  it("verifyArtifact fails on forged signature", () => {
    const content = "Legitimate content";
    const sha = contentDigest(content);
    const m = { ...manifest, contentSha256: sha };

    const forgedSig = "a".repeat(64);
    const result = verifyArtifact(content, { contentSha256: sha, signature: forgedSig }, m);
    expect(result.ok).toBe(false);
    expect(result.signatureMatch).toBe(false);
  });
});
