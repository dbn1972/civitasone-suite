/**
 * Shared outbox (versionedUpdate + VersionConflictError) and pii-crypto coverage.
 *
 * These are tested WITHOUT mocking the modules themselves — they call the REAL
 * implementations so the function coverage counts. The outbox mock has a real
 * db.transaction that the versionedUpdate helper can exercise. pii-crypto is
 * tested with the vitest.config.ts env vars (COURT_PII_KEY, COURT_PII_SALT).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── outbox tests ─────────────────────────────────────────────────────────────
describe("shared/outbox — versionedUpdate + VersionConflictError", () => {
  // We cannot use Drizzle against a real DB, so test VersionConflictError class
  // behavior and the export shape.
  it("VersionConflictError has correct shape", async () => {
    const { VersionConflictError } = await import("../src/shared/outbox.js");
    const err = new VersionConflictError("case", "case-123", 3);
    expect(err.code).toBe("VERSION_CONFLICT");
    expect(err.httpStatus).toBe(409);
    expect(err.entity).toBe("case");
    expect(err.id).toBe("case-123");
    expect(err.expectedVersion).toBe(3);
    expect(err.name).toBe("VersionConflictError");
    expect(err.message).toContain("Optimistic lock conflict");
    expect(err.message).toContain("case-123");
    expect(err.message).toContain("version 3");
  });

  it("versionedUpdate throws VersionConflictError when no rows match", async () => {
    const { versionedUpdate, VersionConflictError } = await import("../src/shared/outbox.js");
    // Fake tx with a chainable update that returns zero rows.
    const fakeTx = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => [],
          }),
        }),
      }),
    };
    // Minimal table-like shape with ._ metadata for Drizzle
    const fakeTable = {
      id: { name: "id" },
      tenantId: { name: "tenant_id" },
      version: { name: "version" },
    };
    await expect(
      versionedUpdate(fakeTx as never, fakeTable as never, {
        id: "rec-1",
        tenantId: "t-1",
        expectedVersion: 5,
        set: { status: "closed" } as never,
        entity: "hearing",
      }),
    ).rejects.toThrow(VersionConflictError);
  });

  it("versionedUpdate succeeds when rows are returned", async () => {
    const { versionedUpdate } = await import("../src/shared/outbox.js");
    const fakeTx = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => [{ id: "rec-1" }],
          }),
        }),
      }),
    };
    const fakeTable = {
      id: { name: "id" },
      tenantId: { name: "tenant_id" },
      version: { name: "version" },
    };
    // Should not throw
    await versionedUpdate(fakeTx as never, fakeTable as never, {
      id: "rec-1",
      tenantId: "t-1",
      expectedVersion: 2,
      set: { status: "active" } as never,
    });
  });

  it("versionedUpdate uses default entity label when entity is omitted", async () => {
    const { versionedUpdate, VersionConflictError } = await import("../src/shared/outbox.js");
    const fakeTx = {
      update: () => ({ set: () => ({ where: () => ({ returning: () => [] }) }) }),
    };
    const fakeTable = { id: {}, tenantId: {}, version: {} };
    try {
      await versionedUpdate(fakeTx as never, fakeTable as never, {
        id: "x",
        tenantId: "t",
        expectedVersion: 1,
        set: {} as never,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(VersionConflictError);
      expect((e as InstanceType<typeof VersionConflictError>).entity).toBe("record");
    }
  });
});

// ── pii-crypto tests ─────────────────────────────────────────────────────────
describe("shared/pii-crypto — encrypt/decrypt/mask/blindIndex", () => {
  beforeEach(async () => {
    // Reset the cached keyring between tests to ensure fresh state
    const mod = await import("../src/shared/pii-crypto.js");
    mod.resetPiiKeyCache();
  });

  it("assertPiiKeyConfigured does not throw with valid env", async () => {
    const { assertPiiKeyConfigured } = await import("../src/shared/pii-crypto.js");
    expect(() => assertPiiKeyConfigured()).not.toThrow();
  });

  it("encryptPii produces enc:v2: envelope", async () => {
    const { encryptPii, isEncrypted } = await import("../src/shared/pii-crypto.js");
    const cipher = encryptPii("test@example.com");
    expect(cipher.startsWith("enc:v2:")).toBe(true);
    expect(isEncrypted(cipher)).toBe(true);
  });

  it("decryptPii round-trips correctly", async () => {
    const { encryptPii, decryptPii } = await import("../src/shared/pii-crypto.js");
    const plain = "9876543210";
    const cipher = encryptPii(plain);
    const decrypted = decryptPii(cipher);
    expect(decrypted).toBe(plain);
  });

  it("decryptPii passes through non-encrypted values (legacy plaintext)", async () => {
    const { decryptPii } = await import("../src/shared/pii-crypto.js");
    expect(decryptPii("plain-text-value")).toBe("plain-text-value");
  });

  it("decryptPii throws PiiDecryptError on tampered ciphertext", async () => {
    const { encryptPii, decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
    const cipher = encryptPii("sensitive");
    // Tamper with the base64 payload
    const tampered = cipher.slice(0, -5) + "XXXXX";
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });

  it("decryptPii throws PiiDecryptError on malformed envelope (missing key id)", async () => {
    const { decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
    // Malformed: "enc:v2:" prefix but no colon-separated key id after it
    expect(() => decryptPii("enc:v2:NOCOLON")).toThrow(PiiDecryptError);
  });

  it("decryptPii throws PiiDecryptError on unknown key id", async () => {
    const { decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
    // Unknown key id "k99" not in the keyring
    expect(() => decryptPii("enc:v2:k99:AAAA")).toThrow(PiiDecryptError);
  });

  it("isEncrypted returns false for plain text", async () => {
    const { isEncrypted } = await import("../src/shared/pii-crypto.js");
    expect(isEncrypted("hello")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });

  it("maskEmail masks correctly", async () => {
    const { maskEmail } = await import("../src/shared/pii-crypto.js");
    expect(maskEmail("rahul@gov.in")).toBe("r***@gov.in");
    expect(maskEmail(null)).toBe(null);
    expect(maskEmail("ab")).toBe("**"); // <=2 chars no @
    expect(maskEmail("x")).toBe("**"); // <=2 chars no @
  });

  it("maskPhone masks correctly", async () => {
    const { maskPhone } = await import("../src/shared/pii-crypto.js");
    expect(maskPhone("9876543210")).toBe("******3210");
    expect(maskPhone(null)).toBe(null);
    expect(maskPhone("1234")).toBe("****"); // <= 4 digits
  });

  it("blindIndex produces deterministic hex hash", async () => {
    const { blindIndex } = await import("../src/shared/pii-crypto.js");
    const h1 = blindIndex("test@example.com");
    const h2 = blindIndex("  Test@Example.Com  "); // same after normalize
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("safeTimingEqualHex compares correctly", async () => {
    const { safeTimingEqualHex } = await import("../src/shared/pii-crypto.js");
    const hex = "abcdef0123456789";
    expect(safeTimingEqualHex(hex, hex)).toBe(true);
    expect(safeTimingEqualHex(hex, "abcdef0123456780")).toBe(false);
    expect(safeTimingEqualHex("aa", "aabb")).toBe(false); // different length
  });

  it("PiiDecryptError has correct shape", async () => {
    const { PiiDecryptError } = await import("../src/shared/pii-crypto.js");
    const err = new PiiDecryptError("test error", { cause: new Error("original") });
    expect(err.code).toBe("PII_DECRYPT_FAILED");
    expect(err.httpStatus).toBe(422);
    expect(err.name).toBe("PiiDecryptError");
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("encryptedText is a customType factory", async () => {
    const { encryptedText } = await import("../src/shared/pii-crypto.js");
    // encryptedText is a Drizzle customType — it exposes a config with dataType/toDriver/fromDriver
    expect(encryptedText).toBeDefined();
    expect(typeof encryptedText).toBe("function");
  });
});
