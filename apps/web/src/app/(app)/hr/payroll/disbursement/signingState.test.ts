import { describe, it, expect } from "vitest";
import {
  hasItems, isValidBankCode, isValidKeyRef, mapIssuedFiles, mapSigningSettings, overridesFromRows, signedBadgeKind,
  toOverrideRows, usesUnsigned,
} from "./signingState";

describe("signedBadgeKind", () => {
  it("only an explicit signed state with a known format is 'signed'", () => {
    expect(signedBadgeKind("pgp_detached", true)).toBe("pgp");
    expect(signedBadgeKind("xml_dsig", true)).toBe("xml");
    expect(signedBadgeKind("pkcs7_detached", true)).toBe("pkcs7");
    expect(signedBadgeKind("pgp_detached", false)).toBe("unsigned");
    expect(signedBadgeKind("none", true)).toBe("unsigned");
    expect(signedBadgeKind(null, true)).toBe("unsigned");
    expect(signedBadgeKind(undefined, false)).toBe("unsigned");
    expect(signedBadgeKind("rot13", true)).toBe("unsigned");
  });
});

describe("bank code / key ref validation", () => {
  it("bank code is exactly 4 capital letters", () => {
    expect(["SBIN", "HDFC"].every(isValidBankCode)).toBe(true);
    expect(["sbin", "SBI", "SBIN1", "SB1N", ""].some(isValidBankCode)).toBe(false);
  });
  it("key ref is a name, not a path", () => {
    expect(["default", "hsm:slot-1/payroll", "a.b_c"].every(isValidKeyRef)).toBe(true);
    expect(["", "../x", "a..b", "/abs", "-x", "a b", "x".repeat(129)].some(isValidKeyRef)).toBe(false);
  });
});

describe("overridesFromRows", () => {
  it("folds rows into a bank->format map, upper-casing codes", () => {
    const r = overridesFromRows([{ rowId: 1, bank: " sbin ", format: "pkcs7_detached" }, { rowId: 2, bank: "HDFC", format: "pgp_detached" }]);
    expect(r).toEqual({ ok: true, value: { SBIN: "pkcs7_detached", HDFC: "pgp_detached" } });
  });
  it("rejects a bad or duplicate bank code", () => {
    expect(overridesFromRows([{ rowId: 1, bank: "SB", format: "none" }])).toEqual({ ok: false, error: "bankCode" });
    expect(overridesFromRows([{ rowId: 1, bank: "SBIN", format: "none" }, { rowId: 2, bank: "sbin", format: "pgp_detached" }])).toEqual({ ok: false, error: "duplicate" });
  });
  it("round-trips with toOverrideRows, and usesUnsigned sees `none` anywhere", () => {
    const rows = toOverrideRows({ SBIN: "none" });
    expect(rows).toEqual([{ rowId: 1, bank: "SBIN", format: "none" }]);
    expect(usesUnsigned("pgp_detached", rows)).toBe(true);
    expect(usesUnsigned("none", [])).toBe(true);
    expect(usesUnsigned("pgp_detached", [])).toBe(false);
  });
});

describe("mapSigningSettings", () => {
  const ok = {
    config: { format: "pgp_detached", perBankOverrides: { SBIN: "pkcs7_detached", HDFC: "bogus" }, encryptToBank: false, keyRef: "default" },
    isDefault: true, unsignedAllowed: false, key: { provider: "dev-file", present: true, fingerprint: "ABCD", detail: null },
  };
  it("maps a valid payload, dropping unknown override formats", () => {
    expect(mapSigningSettings(ok)).toMatchObject({
      config: { format: "pgp_detached", perBankOverrides: { SBIN: "pkcs7_detached" }, encryptToBank: false, keyRef: "default" },
      isDefault: true, unsignedAllowed: false, key: { present: true, fingerprint: "ABCD" },
    });
  });
  it("returns null for anything unusable (never a made-up default)", () => {
    expect(mapSigningSettings(null)).toBeNull();
    expect(mapSigningSettings([])).toBeNull();
    expect(mapSigningSettings({ ...ok, config: { ...ok.config, format: "md5" } })).toBeNull();
    expect(mapSigningSettings({ ...ok, key: undefined })).toBeNull();
  });
});

describe("mapIssuedFiles", () => {
  it("maps the {data} envelope and a bare array; unknown signature format reads as none", () => {
    const row = { id: "a", fileName: "f.csv", runNo: "R1", month: "2026-07", seq: 1, fileFormat: "csv", lineCount: 3, createdAt: "2026-08-01", signatureFormat: "weird", signed: true, hasDetachedSignature: false };
    const out = mapIssuedFiles({ data: [row, { nope: 1 }] });
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: "a", signatureFormat: "none", signed: true, fileSha256: null });
    expect(mapIssuedFiles([row])).toHaveLength(1);
    expect(mapIssuedFiles({})).toBeNull();
    expect(mapIssuedFiles("x")).toBeNull();
  });
  it("hasItems", () => { expect(hasItems([])).toBe(false); expect(hasItems([1])).toBe(true); });
});
