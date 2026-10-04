import { describe, it, expect } from "vitest";
import { canRelease, canSign, canVoid, needsResolve, parseRelease, parseSigning, releaseFailureKey, releaseRefusalKey } from "./signingStatus";

describe("parseSigning", () => {
  it("degrades anything unknown to unsigned", () => {
    expect(parseSigning(undefined).status).toBe("unsigned");
    expect(parseSigning({ status: "weird" }).status).toBe("unsigned");
    expect(parseSigning({ environment: "prod" }).environment).toBeNull();
  });

  it("keeps the certificate info and the mock flag of a signed batch", () => {
    const s = parseSigning({ status: "signed", certificateSerial: "MOCK-ABC", mock: true, environment: "sandbox", signedByName: "A. Officer" });
    expect(s).toMatchObject({ status: "signed", certificateSerial: "MOCK-ABC", mock: true, environment: "sandbox", signedByName: "A. Officer" });
  });

  it("a non-boolean mock flag is null, never assumed real", () => {
    expect(parseSigning({ status: "signed", mock: "no" }).mock).toBeNull();
  });
});

describe("canSign", () => {
  it("only a pending, unsigned batch can be signed", () => {
    expect(canSign("pending", parseSigning({ status: "unsigned" }))).toBe(true);
    expect(canSign("pending", parseSigning({ status: "signed" }))).toBe(false);
    expect(canSign("signed", parseSigning({ status: "unsigned" }))).toBe(false);
    expect(canSign("file_sent", parseSigning({ status: "unsigned" }))).toBe(false);
  });
});

describe("canRelease / releaseRefusalKey", () => {
  it("release is offered only on a signed, not-yet-sent batch", () => {
    expect(canRelease("signed", parseSigning({ status: "signed" }))).toBe(true);
    expect(canRelease("pending", parseSigning({ status: "unsigned" }))).toBe(false);
    expect(canRelease("file_sent", parseSigning({ status: "signed" }))).toBe(false);
    expect(canRelease("signed", parseSigning({ status: "signed_legacy" }))).toBe(false);
  });
  it("every refusal code has its own message key; unknown codes fall back to the generic message", () => {
    for (const c of ["UNSIGNED_BATCH", "MOCK_SIGNATURE", "MAKER_CHECKER_VIOLATION", "BATCH_CHANGED_AFTER_SIGNING", "SIGNATURE_INVALID", "SIGNATURE_UNVERIFIABLE", "INVALID_CHANNEL", "NOT_FOUND"]) {
      expect(releaseRefusalKey(c)).toMatch(/^refused/);
    }
    expect(releaseRefusalKey("SOMETHING_NEW")).toBeNull();
    expect(releaseRefusalKey(null)).toBeNull();
    expect(releaseRefusalKey("toString")).toBeNull();
  });
});

describe("void / resolve / release-failure helpers", () => {
  it("void only on a signed, unsent batch; resolve only on send_unknown", () => {
    expect(canVoid("signed", parseSigning({ status: "signed" }))).toBe(true);
    expect(canVoid("file_sent", parseSigning({ status: "signed" }))).toBe(false);
    expect(canVoid("pending", parseSigning({ status: "unsigned" }))).toBe(false);
    expect(needsResolve("send_unknown")).toBe(true);
    expect(needsResolve("processing")).toBe(false);
  });
  it("parseRelease degrades unknown shapes; releaseFailureKey maps known codes and falls back to the generic one", () => {
    expect(parseRelease(undefined)).toEqual({ startedAt: null, lastFailureCode: null, lastFailureAt: null });
    expect(parseRelease({ lastFailureCode: "SEND_FAILED" }).lastFailureCode).toBe("SEND_FAILED");
    expect(releaseFailureKey("SEND_FAILED")).toBe("releaseFailedSend");
    expect(releaseFailureKey("BATCH_CHANGED_AFTER_SIGNING")).toBe("releaseFailedChanged");
    expect(releaseFailureKey("SOMETHING_NEW")).toBe("releaseFailedGeneric");
    expect(releaseFailureKey(null)).toBeNull();
  });
});
