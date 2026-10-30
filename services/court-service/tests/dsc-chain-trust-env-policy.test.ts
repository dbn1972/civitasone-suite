/**
 * UAT F65 — DSC chain-trust must FAIL CLOSED in production.
 *
 * Before the fix, the issuance callers passed
 * `requireChainTrust: defaultDscTrustStoreProvider.isConfigured()`, so with
 * COURT_DSC_TRUST_STORE_PEM unset a SELF-SIGNED DSC was accepted to issue a
 * court order in every environment, production included (proven on UAT with a
 * throwaway self-signed cert).
 *
 * Owner-approved policy: production (any NODE_ENV other than an explicit
 * "development"/"test") always requires chain trust and refuses to start
 * without a trust store; development/test keep the fail-open behaviour but
 * WARN (once at startup + on every verification).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { signDetachedPkcs7, generateTestDscKeypair } from "@civitasone/render";
import { canonicalOrderContent, verifyOrderDsc } from "../src/modules/order-issuance/dsc-verify.js";
import {
  assertDscChainTrustConfigured,
  resolveDscChainTrustPolicy,
} from "../src/modules/order-issuance/dsc-provider.js";
import { buildApp } from "../src/app.js";

const order = { id: "o-f65", caseId: "c-f65", orderType: "final", orderText: "Allowed.", orderDate: "2026-10-30" };
const content = canonicalOrderContent(order);

// A "self-signed" DSC the court does not recognise (the UAT reproduction).
const selfSigned = generateTestDscKeypair({ cn: "Throwaway Self Signed" });
const selfSignedSig = signDetachedPkcs7({
  content, privateKeyPem: selfSigned.privateKeyPem, certificatePem: selfSigned.certificatePem,
});

// A signer anchored in the configured trust store (chain-valid).
const trustedRoot = generateTestDscKeypair({ cn: "Trusted CCA Root Signer" });
const trustedSig = signDetachedPkcs7({
  content, privateKeyPem: trustedRoot.privateKeyPem, certificatePem: trustedRoot.certificatePem,
});

function spyLogger() {
  return { warn: vi.fn() };
}

beforeEach(() => {
  vi.stubEnv("COURT_DSC_TRUST_STORE_PEM", "");
  vi.stubEnv("COURT_DSC_REQUIRE_CHAIN_TRUST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("F65: production + NO trust store — fail closed", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));

  it("refuses a self-signed DSC (default provider, as the real callers use it)", () => {
    const v = verifyOrderDsc(order, selfSignedSig);
    expect(v.signatureValid).toBe(true); // cryptographically fine...
    expect(v.trustStoreConfigured).toBe(false);
    expect(v.chainTrusted).toBe(false);
    expect(v.issues).toContain("trust_store_not_configured");
    expect(v.acceptedForIssue).toBe(false); // ...but never issuable in production
  });

  it("a caller cannot weaken the policy with requireChainTrust:false", () => {
    expect(verifyOrderDsc(order, selfSignedSig, { requireChainTrust: false }).acceptedForIssue).toBe(false);
  });

  it("startup check refuses to start (API buildApp and the shared assertion)", async () => {
    expect(() => assertDscChainTrustConfigured(undefined, spyLogger())).toThrow(/COURT_DSC_TRUST_STORE_PEM is required/);
    await expect(buildApp()).rejects.toThrow(/COURT_DSC_TRUST_STORE_PEM is required/);
  });

  it("an unset / non-allow-listed NODE_ENV (staging, typo) is treated as production", () => {
    for (const env of ["staging", "uat", "productoin"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(resolveDscChainTrustPolicy().required).toBe(true);
      expect(verifyOrderDsc(order, selfSignedSig).acceptedForIssue).toBe(false);
    }
    delete process.env.NODE_ENV;
    expect(resolveDscChainTrustPolicy()).toMatchObject({ required: true, reason: "production" });
  });
});

describe("F65: production + trust store configured", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COURT_DSC_TRUST_STORE_PEM", trustedRoot.trustPem);
  });

  it("accepts a chain-valid signer", () => {
    const v = verifyOrderDsc(order, trustedSig);
    expect(v.trustStoreConfigured).toBe(true);
    expect(v.chainTrusted).toBe(true);
    expect(v.acceptedForIssue).toBe(true);
  });

  it("refuses a self-signed signer that does not chain to the store", () => {
    const v = verifyOrderDsc(order, selfSignedSig);
    expect(v.signatureValid).toBe(true);
    expect(v.chainTrusted).toBe(false);
    expect(v.acceptedForIssue).toBe(false);
  });

  it("startup check passes without warning", () => {
    const log = spyLogger();
    expect(assertDscChainTrustConfigured(undefined, log)).toMatchObject({ required: true, trustStoreConfigured: true });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("F65: development (UAT posture) + NO trust store — fail open with WARN", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));

  it("accepts a self-signed DSC, reports trustStoreConfigured=false, and warns on the verification", () => {
    const log = spyLogger();
    const v = verifyOrderDsc(order, selfSignedSig, { logger: log });
    expect(v.signatureValid).toBe(true);
    expect(v.chainTrusted).toBe(false);
    expect(v.trustStoreConfigured).toBe(false);
    expect(v.acceptedForIssue).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ orderId: order.id, trustStoreConfigured: false, chainTrusted: false });
    // The signer CN is the judge's name (PII) and must not be logged.
    expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain(selfSigned.subjectCN);
    expect(log.warn.mock.calls[0]![0]).not.toHaveProperty("signerCN");
    expect(String(log.warn.mock.calls[0]![1])).toMatch(/NOT enforced/);
  });

  it("startup does not throw and warns exactly once per process", async () => {
    // Fresh module instance so the once-per-process latch starts clear.
    vi.resetModules();
    const fresh = await import("../src/modules/order-issuance/dsc-provider.js");
    const log = spyLogger();
    expect(fresh.assertDscChainTrustConfigured(undefined, log)).toMatchObject({ required: false });
    fresh.assertDscChainTrustConfigured(undefined, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("still rejects a tampered signature (crypto checks are unaffected)", () => {
    const tampered = verifyOrderDsc({ ...order, orderText: "Dismissed." }, selfSignedSig, { logger: spyLogger() });
    expect(tampered.acceptedForIssue).toBe(false);
  });

  it("does not warn when a trust store is configured (chain trust enforced)", () => {
    vi.stubEnv("COURT_DSC_TRUST_STORE_PEM", trustedRoot.trustPem);
    const log = spyLogger();
    expect(verifyOrderDsc(order, selfSignedSig, { logger: log }).acceptedForIssue).toBe(false);
    expect(verifyOrderDsc(order, trustedSig, { logger: log }).acceptedForIssue).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("F65: COURT_DSC_REQUIRE_CHAIN_TRUST explicit override", () => {
  it("forces chain trust on in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("COURT_DSC_REQUIRE_CHAIN_TRUST", "true");
    expect(resolveDscChainTrustPolicy()).toMatchObject({ required: true, reason: "forced_by_env" });
    expect(verifyOrderDsc(order, selfSignedSig).acceptedForIssue).toBe(false);
    expect(() => assertDscChainTrustConfigured(undefined, spyLogger())).toThrow(/COURT_DSC_TRUST_STORE_PEM is required/);
  });

  it("cannot switch enforcement off in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COURT_DSC_REQUIRE_CHAIN_TRUST", "false");
    expect(resolveDscChainTrustPolicy().required).toBe(true);
    expect(verifyOrderDsc(order, selfSignedSig).acceptedForIssue).toBe(false);
  });
});
