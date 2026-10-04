/**
 * GAP-FINANCE-PFMS-01 -- tenant DSC signer resolution (pure: the descriptor lookup is injected).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NotImplementedError } from "@civitasone/connector-framework/ports";

import { resolveDscSigner, signerRefFor, DscChannelError, type DscDescriptor } from "../src/modules/pfms/dsc-client.js";

const descriptor = (o: Partial<DscDescriptor> = {}): DscDescriptor => ({
  providerKey: "dsc_usb_token_bridge", providerName: "USB token bridge", environment: "sandbox", config: { certificateThumbprint: "ab".repeat(20) }, endpointUrl: null, ...o,
});

describe("resolveDscSigner", () => {
  afterEach(() => vi.unstubAllEnvs());
  const hash = "a".repeat(64);

  it("sandbox integration -> the MOCK signer, labelled mock, signing identity from the certificate thumbprint", async () => {
    const r = await resolveDscSigner("t1", async () => descriptor());
    expect(r).toMatchObject({ environment: "sandbox", mock: true, providerKey: "dsc_usb_token_bridge", signerRef: "ab".repeat(20) });
    const sig = await r.signer.sign({ payloadHashSha256: hash, signerRef: r.signerRef, reason: "t" });
    expect(sig.algorithm).toMatch(/^MOCK-/);
    expect(sig.certificateSerial).toMatch(/^MOCK-/);
  });

  it("production integration -> the production stub, which refuses (NotImplemented) until the real channel is wired in UAT", async () => {
    const r = await resolveDscSigner("t1", async () => descriptor({ environment: "production" }));
    expect(r.mock).toBe(false);
    await expect(r.signer.sign({ payloadHashSha256: hash, signerRef: r.signerRef, reason: "t" })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("no integration configured: a sandbox mock in dev/test, a hard refusal in a production deployment", async () => {
    const dev = await resolveDscSigner("t1", async () => null);
    expect(dev).toMatchObject({ environment: "sandbox", mock: true });
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveDscSigner("t1", async () => null)).rejects.toMatchObject({ code: "DSC_NOT_CONFIGURED", permanent: true });
  });

  it("production with a SANDBOX (mock) integration: no mock signer is ever returned (DSC_SANDBOX_IN_PRODUCTION)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(resolveDscSigner("t1", async () => descriptor())).rejects.toMatchObject({ code: "DSC_SANDBOX_IN_PRODUCTION", permanent: true });
  });

  it("fail closed on NODE_ENV: unset, staging and prod behave as production (no mock fallback, no mock signer)", async () => {
    for (const v of ["", "staging", "prod"]) {
      vi.stubEnv("NODE_ENV", v);
      await expect(resolveDscSigner("t1", async () => null), v).rejects.toMatchObject({ code: "DSC_NOT_CONFIGURED" });
      await expect(resolveDscSigner("t1", async () => descriptor()), v).rejects.toMatchObject({ code: "DSC_SANDBOX_IN_PRODUCTION" });
    }
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("PFMS_SANDBOX", "true"); // the explicit opt-in
    expect(await resolveDscSigner("t1", async () => null)).toMatchObject({ mock: true });
    vi.stubEnv("NODE_ENV", "production"); // ...which production refuses
    await expect(resolveDscSigner("t1", async () => null)).rejects.toMatchObject({ code: "DSC_NOT_CONFIGURED" });
  });

  it("an unreachable config lookup is a transient (retryable) error, never a silent sandbox fallback", async () => {
    const err = await resolveDscSigner("t1", async () => { throw new DscChannelError("DSC_CONFIG_UNAVAILABLE", "down", false); }).catch((e) => e);
    expect(err).toMatchObject({ code: "DSC_CONFIG_UNAVAILABLE", permanent: false });
  });

  it("signerRefFor prefers the thumbprint, then the HSM key label, then a provider default (never key material)", () => {
    expect(signerRefFor({ certificateThumbprint: " T1 ", keyLabel: "K" }, "p")).toBe("T1");
    expect(signerRefFor({ keyLabel: "K" }, "p")).toBe("K");
    expect(signerRefFor({}, "p")).toBe("p:default");
  });
});

