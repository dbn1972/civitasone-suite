/**
 * src/shared/pii-crypto.ts — AES-256-GCM at-rest encryption + HMAC blind index
 * (DPDP Act 2023).
 *
 * This module is the thing standing between a bounce recipient / device token
 * and a plaintext database column, so its failure modes matter as much as its
 * happy path: a missing key must fail closed, and a tampered ciphertext must
 * throw rather than return something plausible.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  encryptPii,
  decryptPii,
  isEncrypted,
  blindIndex,
  resetPiiKeyCache,
  PiiDecryptError,
} from "../src/shared/pii-crypto.js";

const KEY = process.env.NOTIFICATION_PII_KEY as string;
const SALT = process.env.NOTIFICATION_PII_SALT;

/** Restore the vitest-configured key material and drop the derived-key cache. */
function restoreEnv(): void {
  process.env.NOTIFICATION_PII_KEY = KEY;
  if (SALT === undefined) delete process.env.NOTIFICATION_PII_SALT;
  else process.env.NOTIFICATION_PII_SALT = SALT;
  delete process.env.NOTIFICATION_PII_KEY_ID;
  delete process.env.NOTIFICATION_PII_KEYRING;
  resetPiiKeyCache();
}

afterEach(restoreEnv);

describe("encryptPii / decryptPii", () => {
  it("round-trips a value", () => {
    expect(decryptPii(encryptPii("officer@dept.gov.in"))).toBe("officer@dept.gov.in");
  });

  it("round-trips a phone number", () => {
    expect(decryptPii(encryptPii("+919812345678"))).toBe("+919812345678");
  });

  it("round-trips non-ASCII text", () => {
    expect(decryptPii(encryptPii("राजेश कुमार"))).toBe("राजेश कुमार");
  });

  it("round-trips an empty string", () => {
    expect(decryptPii(encryptPii(""))).toBe("");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptPii("officer@dept.gov.in");
    const b = encryptPii("officer@dept.gov.in");
    expect(a).not.toBe(b);
    // Which is exactly why equality lookups need the blind index.
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("stamps the enc:v2 envelope with the key id", () => {
    expect(encryptPii("x").startsWith("enc:v2:k1:")).toBe(true);
  });

  it("never leaks the cleartext into the envelope", () => {
    expect(encryptPii("officer@dept.gov.in")).not.toContain("officer@dept.gov.in");
  });

  it("honours a custom key id", () => {
    process.env.NOTIFICATION_PII_KEY_ID = "k9";
    resetPiiKeyCache();
    expect(encryptPii("x").startsWith("enc:v2:k9:")).toBe(true);
  });
});

describe("isEncrypted", () => {
  it("recognises the v2 envelope", () => {
    expect(isEncrypted(encryptPii("x"))).toBe(true);
  });

  it("rejects plaintext", () => {
    expect(isEncrypted("officer@dept.gov.in")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isEncrypted("")).toBe(false);
  });
});

describe("decryptPii — failure modes", () => {
  it("passes legacy plaintext through unchanged (not yet backfilled)", () => {
    expect(decryptPii("officer@dept.gov.in")).toBe("officer@dept.gov.in");
  });

  it("throws on a malformed envelope with no key id", () => {
    expect(() => decryptPii("enc:v2:garbage")).toThrow(PiiDecryptError);
  });

  it("throws when the key id is not in the keyring (rotation gap)", () => {
    const cipher = encryptPii("x");
    const swapped = cipher.replace("enc:v2:k1:", "enc:v2:k404:");
    expect(() => decryptPii(swapped)).toThrow(/no PII key for key id/);
  });

  it("throws on a tampered ciphertext rather than returning something plausible", () => {
    const cipher = encryptPii("officer@dept.gov.in");
    const tampered = `${cipher.slice(0, -4)}AAAA`;
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });

  it("throws when the key changed under an existing ciphertext", () => {
    const cipher = encryptPii("officer@dept.gov.in");
    process.env.NOTIFICATION_PII_KEY = "a-completely-different-master-secret";
    resetPiiKeyCache();
    expect(() => decryptPii(cipher)).toThrow(PiiDecryptError);
  });

  it("exposes a stable error code for the error envelope", () => {
    try {
      decryptPii("enc:v2:nokeyid");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as PiiDecryptError).code).toBe("PII_DECRYPT_FAILED");
      expect((err as Error).name).toBe("PiiDecryptError");
    }
  });
});

describe("keyring rotation", () => {
  it("reads a ciphertext written under a retired key", () => {
    const oldSecret = "retired-master-secret-value-16+";
    process.env.NOTIFICATION_PII_KEY = oldSecret;
    process.env.NOTIFICATION_PII_KEY_ID = "k0";
    resetPiiKeyCache();
    const cipher = encryptPii("officer@dept.gov.in");

    // Rotate: new active key, old key retained in the keyring.
    process.env.NOTIFICATION_PII_KEY = KEY;
    process.env.NOTIFICATION_PII_KEY_ID = "k1";
    process.env.NOTIFICATION_PII_KEYRING = JSON.stringify({ k0: oldSecret });
    resetPiiKeyCache();

    expect(decryptPii(cipher)).toBe("officer@dept.gov.in");
    // New writes use the new key.
    expect(encryptPii("x").startsWith("enc:v2:k1:")).toBe(true);
  });

  it("rejects a keyring that is not valid JSON", () => {
    process.env.NOTIFICATION_PII_KEYRING = "{not json";
    resetPiiKeyCache();
    expect(() => encryptPii("x")).toThrow(/not valid JSON/);
  });

  it("ignores keyring entries whose secret is too short to be safe", () => {
    process.env.NOTIFICATION_PII_KEYRING = JSON.stringify({ k0: "tooshort" });
    resetPiiKeyCache();
    // The active key still works; the unsafe entry is simply not loaded.
    expect(decryptPii(encryptPii("x"))).toBe("x");
  });

  it("ignores a blank keyring", () => {
    process.env.NOTIFICATION_PII_KEYRING = "   ";
    resetPiiKeyCache();
    expect(decryptPii(encryptPii("x"))).toBe("x");
  });
});

describe("fail-closed key handling", () => {
  it("throws when the key is absent — never silently stores plaintext", () => {
    delete process.env.NOTIFICATION_PII_KEY;
    resetPiiKeyCache();
    expect(() => encryptPii("officer@dept.gov.in")).toThrow(/NOTIFICATION_PII_KEY is required/);
  });

  it("throws when the key is too short", () => {
    process.env.NOTIFICATION_PII_KEY = "short";
    resetPiiKeyCache();
    expect(() => encryptPii("x")).toThrow(/>=16 chars/);
  });

  it("throws on blindIndex too when the key is absent", () => {
    delete process.env.NOTIFICATION_PII_KEY;
    resetPiiKeyCache();
    expect(() => blindIndex("x")).toThrow(/NOTIFICATION_PII_KEY is required/);
  });
});

describe("blindIndex", () => {
  it("is deterministic", () => {
    expect(blindIndex("officer@dept.gov.in")).toBe(blindIndex("officer@dept.gov.in"));
  });

  it("normalises case", () => {
    expect(blindIndex("Officer@Dept.Gov.In")).toBe(blindIndex("officer@dept.gov.in"));
  });

  it("normalises surrounding whitespace", () => {
    expect(blindIndex("  officer@dept.gov.in  ")).toBe(blindIndex("officer@dept.gov.in"));
  });

  it("differs for different values", () => {
    expect(blindIndex("a@dept.gov.in")).not.toBe(blindIndex("b@dept.gov.in"));
  });

  it("is a 64-char hex digest and irreversible — never the address itself", () => {
    const index = blindIndex("officer@dept.gov.in");
    expect(index).toMatch(/^[0-9a-f]{64}$/);
    expect(index).not.toContain("officer");
  });

  it("is domain-separated from the encryption key (changing the salt changes it)", () => {
    const before = blindIndex("officer@dept.gov.in");
    process.env.NOTIFICATION_PII_SALT = "a-different-salt";
    resetPiiKeyCache();
    expect(blindIndex("officer@dept.gov.in")).not.toBe(before);
  });

  it("falls back to the default salt when none is configured", () => {
    delete process.env.NOTIFICATION_PII_SALT;
    resetPiiKeyCache();
    expect(blindIndex("officer@dept.gov.in")).toMatch(/^[0-9a-f]{64}$/);
  });
});
