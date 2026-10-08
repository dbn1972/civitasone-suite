/**
 * GAP-COURT-ORDERS-02 - DSC chain-trust policy (pure, no DB).
 * When a trust store is configured, a signer that does not chain to it (a
 * self-signed DSC) must NOT be accepted to issue an order. When no trust store
 * is configured the signature is still verified but chain trust is not required.
 */
import { describe, it, expect } from "vitest";
import { signDetachedPkcs7, generateTestDscKeypair } from "@civitasone/render";
import { canonicalOrderContent, verifyOrderDsc } from "../src/modules/order-issuance/dsc-verify.js";
import type { DscTrustStoreProvider } from "../src/modules/order-issuance/dsc-provider.js";

const order = { id: "o-1", caseId: "c-1", orderType: "final", orderText: "Allowed.", orderDate: "2026-07-11" };
const signer = generateTestDscKeypair({ cn: "Self Signed Judge" });
const unrelatedRoot = generateTestDscKeypair({ cn: "Unrelated Root CA" });
const sig = signDetachedPkcs7({
  content: canonicalOrderContent(order), privateKeyPem: signer.privateKeyPem, certificatePem: signer.certificatePem,
});

const unconfigured: DscTrustStoreProvider = { getTrustStorePem: () => null, isConfigured: () => false };
const configured: DscTrustStoreProvider = {
  getTrustStorePem: () => unrelatedRoot.certificatePem, isConfigured: () => true,
};

describe("verifyOrderDsc chain-trust policy", () => {
  it("unconfigured trust store: valid signature accepted, chain not required", () => {
    const v = verifyOrderDsc(order, sig, { provider: unconfigured });
    expect(v.signatureValid).toBe(true);
    expect(v.trustStoreConfigured).toBe(false);
    expect(v.acceptedForIssue).toBe(true);
  });

  it("configured trust store: self-signed DSC is rejected by default (fail-closed)", () => {
    const v = verifyOrderDsc(order, sig, { provider: configured });
    expect(v.signatureValid).toBe(true);
    expect(v.chainTrusted).toBe(false);
    expect(v.trustStoreConfigured).toBe(true);
    expect(v.acceptedForIssue).toBe(false);
  });

  it("requireChainTrust true is rejected even when unconfigured", () => {
    expect(verifyOrderDsc(order, sig, { provider: unconfigured, requireChainTrust: true }).acceptedForIssue).toBe(false);
  });
});
