import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetPiiKeyCache, encryptPii } from "../src/shared/pii-crypto.js";
import { uanBlindIndex, uanBlindIndexCandidates, normaliseUan, blindIndexKeyId, activeBlindIndexKeyId } from "../src/shared/blind-index.js";
import { parseArgs, planRow } from "../scripts/backfill-uan-encryption.js";

const T1 = randomUUID();
const T2 = randomUUID();
const UAN = "101234567890";
const saved = { k: process.env.PII_ENC_KEY, id: process.env.PII_KEY_ID, ring: process.env.PII_ENC_KEYRING };
// Test-only key material generated per run (never a literal secret).
const keyA = `a-${randomUUID()}-${randomUUID()}`;
const keyB = `b-${randomUUID()}-${randomUUID()}`;

beforeEach(() => { process.env.PII_ENC_KEY = keyA; delete process.env.PII_KEY_ID; delete process.env.PII_ENC_KEYRING; resetPiiKeyCache(); });
afterEach(() => {
  for (const [k, v] of [["PII_ENC_KEY", saved.k], ["PII_KEY_ID", saved.id], ["PII_ENC_KEYRING", saved.ring]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetPiiKeyCache();
});

describe("UAN blind index", () => {
  it("is deterministic, keyed by the key id, and never contains the UAN", () => {
    const a = uanBlindIndex(T1, UAN)!;
    expect(a).toBe(uanBlindIndex(T1, UAN));
    expect(a).toMatch(/^k1\.[0-9a-f]{64}$/);
    expect(a).not.toContain(UAN);
    expect(blindIndexKeyId(a)).toBe("k1");
    expect(activeBlindIndexKeyId()).toBe("k1");
  });

  it("differs per tenant and per value (no cross-tenant correlation)", () => {
    expect(uanBlindIndex(T1, UAN)).not.toBe(uanBlindIndex(T2, UAN));
    expect(uanBlindIndex(T1, UAN)).not.toBe(uanBlindIndex(T1, "101234567891"));
  });

  it("normalises whitespace and treats empty as no index", () => {
    expect(normaliseUan(" 1012 3456 7890 ")).toBe(UAN);
    expect(uanBlindIndex(T1, " 1012 3456 7890 ")).toBe(uanBlindIndex(T1, UAN));
    expect(uanBlindIndex(T1, "   ")).toBeNull();
    expect(uanBlindIndex(T1, null)).toBeNull();
    expect(uanBlindIndexCandidates(T1, "")).toEqual([]);
  });

  it("depends on the secret: another key gives another index", () => {
    const a = uanBlindIndex(T1, UAN)!.split(".")[1];
    process.env.PII_ENC_KEY = keyB; resetPiiKeyCache();
    expect(uanBlindIndex(T1, UAN)!.split(".")[1]).not.toBe(a);
  });

  it("survives key rotation: a lookup still produces the value written under the retired key", () => {
    const written = uanBlindIndex(T1, UAN)!; // under k1 = keyA
    process.env.PII_ENC_KEY = keyB; process.env.PII_KEY_ID = "k2"; process.env.PII_ENC_KEYRING = JSON.stringify({ k1: keyA });
    resetPiiKeyCache();
    const cands = uanBlindIndexCandidates(T1, UAN);
    expect(cands).toContain(written);
    expect(cands).toHaveLength(2);
    expect(uanBlindIndex(T1, UAN)).toMatch(/^k2\./); // new writes use the active key
  });
});

describe("backfill planning and arguments", () => {
  const base = { id: randomUUID(), uan_number: null, pan: null, bank_account_no: null, bank_ifsc: null, uan_bidx: null } as Record<string, string | null> & { id: string; uan_bidx: string | null };
  const cols = ["uan_number", "pan", "bank_account_no", "bank_ifsc"] as const;

  it("plaintext UAN: seal and index; sealed UAN without index: index only; fully done: nothing", () => {
    expect(planRow({ ...base, uan_number: UAN }, cols, "k1", false)).toEqual({ seal: ["uan_number"], needsIndex: true, reindexing: false });
    expect(planRow({ ...base, uan_number: encryptPii(UAN) }, cols, "k1", false)).toEqual({ seal: [], needsIndex: true, reindexing: false });
    expect(planRow({ ...base, uan_number: encryptPii(UAN), uan_bidx: "k1.abc" }, cols, "k1", false)).toEqual({ seal: [], needsIndex: false, reindexing: false });
  });

  it("never re-encrypts a sealed value, ignores empty values, and honours the column subset", () => {
    expect(planRow({ ...base, pan: encryptPii("ABCDE1234F"), bank_ifsc: "" }, cols, "k1", false).seal).toEqual([]);
    expect(planRow({ ...base, pan: "ABCDE1234F", uan_number: UAN }, ["pan"], "k1", false).seal).toEqual(["pan"]);
  });

  it("--reindex only re-indexes rows indexed under a different key id", () => {
    const row = { ...base, uan_number: encryptPii(UAN), uan_bidx: "k0.abc" };
    expect(planRow(row, cols, "k1", false).needsIndex).toBe(false);
    expect(planRow(row, cols, "k1", true)).toMatchObject({ needsIndex: true, reindexing: true });
    expect(planRow({ ...row, uan_bidx: "k1.abc" }, cols, "k1", true).needsIndex).toBe(false);
  });

  it("parses arguments strictly; dry run is the default", () => {
    const t = randomUUID();
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(["--apply", "--tenant", t, "--batch-size", "50", "--max-rows", "10", "--reindex", "--columns", "uan_number"]))
      .toMatchObject({ apply: true, tenants: [t], batchSize: 50, maxRows: 10, reindex: true, columns: ["uan_number"] });
    expect(() => parseArgs(["--columns", "email"])).toThrow(/subset/);
    expect(() => parseArgs(["--columns", "uan_number; drop table x"])).toThrow(/subset/);
    expect(() => parseArgs(["--batch-size", "0"])).toThrow();
    expect(() => parseArgs(["--tenant", "nope"])).toThrow(/tenant uuid/);
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow(/mutually exclusive/);
    expect(() => parseArgs(["--after", t])).toThrow(/exactly one --tenant/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
  });
});
