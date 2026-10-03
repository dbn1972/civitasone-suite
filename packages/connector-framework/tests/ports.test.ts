/**
 * Platform-integration adapter ports: sandbox mocks exercise a flow end to end,
 * production adapters are NotImplemented stubs that name the provider.
 */
import { describe, it, expect } from "vitest";
import {
  AdapterError,
  NotImplementedError,
  createAdapter,
  createBankApi,
  createDscSigner,
  createEsignProvider,
  hasRealAdapter,
  type AdapterContext,
} from "../src/ports/index.js";

const HASH = "a".repeat(64);
const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  providerKey: "esign_nsdl_egov",
  providerName: "NSDL e-Gov eSign",
  environment: "sandbox",
  config: {},
  secrets: {},
  ...over,
});

describe("eSign mock (sandbox)", () => {
  it("initiate -> verify walks pending -> signed -> expired on a deterministic clock", async () => {
    let now = 1_800_000_000_000;
    const esign = createEsignProvider(ctx(), { now: () => now });
    const init = await esign.initiate({ documentId: "d1", documentHashSha256: HASH, signerName: "A", signerRef: "emp-1", reason: "offer letter" });
    expect(init.transactionId).toMatch(/^MOCKESIGN-/);
    expect(init.redirectUrl).toContain("sandbox.invalid");
    expect((await esign.verify({ transactionId: init.transactionId })).status).toBe("pending");
    now += 4_000;
    const done = await esign.verify({ transactionId: init.transactionId });
    expect(done.status).toBe("signed");
    expect(done.certificateSerial).toMatch(/^MOCK-/);
    now += 11 * 60_000;
    expect((await esign.verify({ transactionId: init.transactionId })).status).toBe("expired");
  });

  it("scenarios force failures; bad input and unknown ids are rejected", async () => {
    expect(await createEsignProvider(ctx({ config: { sandboxScenario: "auth_failed" } })).testConnection()).toMatchObject({ ok: false, code: "AUTH_FAILED", mock: true });
    expect(await createEsignProvider(ctx({ config: { sandboxScenario: "timeout" } })).testConnection()).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(await createEsignProvider(ctx({ config: { sandboxScenario: "provider_rejected" } })).testConnection()).toMatchObject({ ok: false, code: "PROVIDER_REJECTED" });
    expect(await createEsignProvider(ctx()).testConnection()).toMatchObject({ ok: true, code: "OK", mock: true });
    const e = createEsignProvider(ctx());
    await expect(e.initiate({ documentId: "d", documentHashSha256: "xyz", signerName: "A", signerRef: "r", reason: "r" })).rejects.toBeInstanceOf(AdapterError);
    await expect(e.verify({ transactionId: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_TRANSACTION" });
    await expect(createEsignProvider(ctx({ config: { sandboxScenario: "auth_failed" } })).initiate({ documentId: "d", documentHashSha256: HASH, signerName: "A", signerRef: "r", reason: "r" })).rejects.toMatchObject({ code: "AUTH_FAILED" });
    const declined = createEsignProvider(ctx({ config: { sandboxScenario: "provider_rejected" } }), { now: () => 1_800_000_000_000 });
    const t = await declined.initiate({ documentId: "d", documentHashSha256: HASH, signerName: "A", signerRef: "r", reason: "r" });
    expect((await declined.verify({ transactionId: t.transactionId })).status).toBe("failed");
  });
});

describe("DSC mock (sandbox)", () => {
  it("signs a hash with a clearly-labelled placeholder signature", async () => {
    const dsc = createDscSigner(ctx({ providerKey: "dsc_usb_token_bridge", providerName: "USB token bridge" }));
    const r = await dsc.sign({ payloadHashSha256: HASH, signerRef: "slot-1", reason: "payslip" });
    expect(r.algorithm).toMatch(/^MOCK-/);
    expect(atob(r.signatureBase64)).toContain("MOCK-DSC");
    expect(r.certificateSerial).toMatch(/^MOCK-/);
    await expect(dsc.sign({ payloadHashSha256: "bad", signerRef: "s", reason: "r" })).rejects.toMatchObject({ code: "INVALID_HASH" });
  });

  it("failure scenarios surface as AdapterError codes", async () => {
    for (const [scenario, code] of [["auth_failed", "AUTH_FAILED"], ["timeout", "TIMEOUT"], ["provider_rejected", "PROVIDER_REJECTED"]] as const) {
      const dsc = createDscSigner(ctx({ providerKey: "dsc_remote_hsm", config: { sandboxScenario: scenario } }));
      await expect(dsc.sign({ payloadHashSha256: HASH, signerRef: "s", reason: "r" })).rejects.toMatchObject({ code });
    }
  });
});

describe("bank API mock (sandbox)", () => {
  const file = { fileName: "SAL-OCT.csv", fileFormat: "csv" as const, fileHashSha256: HASH, recordCount: 3, totalAmountMinor: 12_345_600n };

  it("submitPaymentFile -> fetchStatus walks received -> processing -> processed", async () => {
    let now = 1_800_000_000_000;
    const bank = createBankApi(ctx({ providerKey: "bank_sbi", providerName: "State Bank of India" }), { now: () => now });
    const sub = await bank.submitPaymentFile(file);
    expect(sub.accepted).toBe(true);
    expect((await bank.fetchStatus({ submissionId: sub.submissionId })).status).toBe("received");
    now += 6_000;
    expect((await bank.fetchStatus({ submissionId: sub.submissionId })).status).toBe("processing");
    now += 10_000;
    expect(await bank.fetchStatus({ submissionId: sub.submissionId })).toMatchObject({ status: "processed", failedCount: 0 });
  });

  it("rejects an empty batch; a provider_rejected scenario yields a rejected submission", async () => {
    const bank = createBankApi(ctx({ providerKey: "bank_sbi" }));
    await expect(bank.submitPaymentFile({ ...file, totalAmountMinor: 0n })).rejects.toMatchObject({ code: "EMPTY_BATCH" });
    const rej = createBankApi(ctx({ providerKey: "bank_sbi", config: { sandboxScenario: "provider_rejected" } }), { now: () => 1_800_000_000_000 });
    const sub = await rej.submitPaymentFile(file);
    expect(sub.accepted).toBe(false);
    expect((await rej.fetchStatus({ submissionId: sub.submissionId })).status).toBe("rejected");
    await expect(bank.fetchStatus({ submissionId: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_SUBMISSION" });
  });
});

describe("production adapters are NotImplemented stubs that name the provider", () => {
  const prod = (over: Partial<AdapterContext> = {}) => ctx({ environment: "production", ...over });

  it("every operation throws NotImplementedError carrying the provider name", async () => {
    const esign = createEsignProvider(prod());
    await expect(esign.initiate({ documentId: "d", documentHashSha256: HASH, signerName: "A", signerRef: "r", reason: "r" })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(esign.verify({ transactionId: "t" })).rejects.toThrow(/NSDL e-Gov eSign/);
    await expect(createDscSigner(prod({ providerName: "Remote HSM" })).sign({ payloadHashSha256: HASH, signerRef: "s", reason: "r" })).rejects.toThrow(/Remote HSM/);
    const bank = createBankApi(prod({ providerName: "HDFC Bank" }));
    await expect(bank.submitPaymentFile({ fileName: "f", fileFormat: "csv", fileHashSha256: HASH, recordCount: 1, totalAmountMinor: 1n })).rejects.toThrow(/HDFC Bank/);
    await expect(bank.fetchStatus({ submissionId: "s" })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(createAdapter("pfms", prod({ providerName: "PFMS" })).testConnection()).rejects.toThrow(/PFMS/);
    expect(createEsignProvider(prod()).mock).toBe(false);
  });

  it("no provider has a real adapter yet, and pfms sandbox supports connection test only", async () => {
    expect(hasRealAdapter("esign_nsdl_egov")).toBe(false);
    expect(await createAdapter("pfms", ctx({ providerKey: "pfms_epayment" })).testConnection()).toMatchObject({ ok: true, mock: true });
  });
});
