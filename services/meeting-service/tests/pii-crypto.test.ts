import { afterEach, describe, expect, it } from "vitest";
import {
  assertPiiKeyConfigured,
  blindIndex,
  classifiedText,
  decryptClassified,
  decryptPii,
  encryptClassified,
  encryptedText,
  encryptPii,
  isClassified,
  isEncrypted,
  maskEmail,
  maskPhone,
  PiiDecryptError,
  resetPiiKeyCache,
  safeTimingEqualHex,
} from "../src/shared/pii-crypto.js";

// The vitest env (vitest.config.ts) provides MEETING_PII_KEY, MEETING_PII_SALT,
// and MEETING_CLASSIFIED_KEY. Reset the cached keyrings after any test that
// mutates the environment so it does not leak into others.
afterEach(() => {
  resetPiiKeyCache();
});

describe("encryptedText / PII layer (Req 15.3 — DPDP at-rest encryption)", () => {
  it("round-trips cleartext through encrypt -> decrypt", () => {
    const plain = "chairperson@dept.gov.in";
    const cipher = encryptPii(plain);
    expect(decryptPii(cipher)).toBe(plain);
  });

  it("stores ciphertext, never cleartext, with the enc:v2 envelope", () => {
    const plain = "+91 98765 43210";
    const cipher = encryptPii(plain);
    expect(cipher.startsWith("enc:v2:")).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(isEncrypted(cipher)).toBe(true);
  });

  it("produces a fresh IV per call (same plaintext -> different ciphertext)", () => {
    const a = encryptPii("same-value");
    const b = encryptPii("same-value");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("passes through legacy plaintext / not-yet-backfilled values", () => {
    expect(decryptPii("legacy-plaintext")).toBe("legacy-plaintext");
    expect(isEncrypted("legacy-plaintext")).toBe(false);
  });

  it("fails closed with PiiDecryptError on tampered ciphertext", () => {
    const cipher = encryptPii("sensitive");
    const tampered = `${cipher.slice(0, -4)}AAAA`;
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });

  it("throws PiiDecryptError for an unknown key id (rotation/keyring gap)", () => {
    expect(() => decryptPii("enc:v2:unknownkey:AAAABBBBCCCC")).toThrow(PiiDecryptError);
  });

  it("exposes the encryptedText Drizzle column builder", () => {
    // encryptedText is a Drizzle customType factory; calling it yields a column
    // builder usable in schema.ts (the encrypt/decrypt round-trip itself is
    // covered by the encryptPii/decryptPii cases above).
    expect(typeof encryptedText).toBe("function");
    expect(encryptedText("personal_email")).toBeDefined();
  });
});

describe("classifiedText / second-layer classified content", () => {
  it("round-trips through the classified layer with its own cls:v2 envelope", () => {
    const plain = "Top-Secret briefing note";
    const cipher = encryptClassified(plain);
    expect(cipher.startsWith("cls:v2:")).toBe(true);
    expect(isClassified(cipher)).toBe(true);
    expect(decryptClassified(cipher)).toBe(plain);
  });

  it("is cryptographically separated from the PII layer", () => {
    const plain = "classified-value";
    const classifiedCipher = encryptClassified(plain);
    // The PII layer must not recognise or decrypt a classified envelope.
    expect(isEncrypted(classifiedCipher)).toBe(false);
    // And the classified layer must not recognise a PII envelope.
    const piiCipher = encryptPii(plain);
    expect(isClassified(piiCipher)).toBe(false);
  });

  it("exposes the classifiedText Drizzle column builder", () => {
    expect(typeof classifiedText).toBe("function");
    expect(classifiedText("note")).toBeDefined();
  });
});

describe("masking + blind index helpers", () => {
  it("masks emails keeping first char and domain", () => {
    expect(maskEmail("secretary@dept.gov.in")).toBe("s***@dept.gov.in");
    expect(maskEmail(null)).toBeNull();
  });

  it("masks phone numbers keeping the last four digits", () => {
    expect(maskPhone("9876543210")).toBe("******3210");
    expect(maskPhone("123")).toBe("****");
  });

  it("produces a deterministic, comparable blind index", () => {
    const a = blindIndex("Member@Dept.gov.in");
    const b = blindIndex("member@dept.gov.in "); // trimmed + lowercased -> same
    expect(a).toBe(b);
    expect(safeTimingEqualHex(a, b)).toBe(true);
    expect(safeTimingEqualHex(a, blindIndex("someone-else"))).toBe(false);
  });
});

describe("fail-fast key configuration (steering: fail-fast on missing config)", () => {
  it("throws when MEETING_PII_KEY is missing", () => {
    const saved = process.env.MEETING_PII_KEY;
    delete process.env.MEETING_PII_KEY;
    resetPiiKeyCache();
    try {
      expect(() => assertPiiKeyConfigured()).toThrow(/MEETING_PII_KEY is required/);
    } finally {
      process.env.MEETING_PII_KEY = saved;
      resetPiiKeyCache();
    }
  });

  it("throws when MEETING_PII_KEY is too short (<16 chars)", () => {
    const saved = process.env.MEETING_PII_KEY;
    process.env.MEETING_PII_KEY = "short";
    resetPiiKeyCache();
    try {
      expect(() => assertPiiKeyConfigured()).toThrow(/>=16 chars/);
    } finally {
      process.env.MEETING_PII_KEY = saved;
      resetPiiKeyCache();
    }
  });

  it("accepts the configured key (no throw)", () => {
    expect(() => assertPiiKeyConfigured()).not.toThrow();
  });
});
