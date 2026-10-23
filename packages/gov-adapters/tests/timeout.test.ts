import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CLOS2-S6-12: a gateway that accepts the connection and never replies must not hang
 * the caller. The stubbed fetch only settles when the request's AbortSignal fires.
 */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      if (!init?.signal) return; // no signal => never settles (the pre-fix hang)
      init.signal.addEventListener("abort", () => rej(init.signal!.reason));
    }));
}

async function load(mod: "pfms" | "gstn") {
  vi.resetModules();
  return import(`../src/${mod}.ts`);
}

const RACE_MS = 1500;
/** Fails the test (instead of hanging) if the call has not settled. */
async function settle<T>(p: Promise<T>): Promise<unknown> {
  return Promise.race([
    p.then(() => "resolved", (e: unknown) => e),
    new Promise((r) => setTimeout(() => r("HUNG"), RACE_MS)),
  ]);
}

beforeEach(() => {
  process.env.PFMS_MODE = "sandbox";
  process.env.PFMS_AGENCY_CODE = "AG1";
  process.env.PFMS_AUTH_TOKEN = "t-test";
  process.env.PFMS_TIMEOUT_MS = "60";
  process.env.GSTN_MODE = "sandbox";
  process.env.GSTN_CLIENT_ID = "cid";
  process.env.GSTN_CLIENT_SECRET = "csec";
  process.env.GSTN_GSTIN = "29ABCDE1234F1Z5";
  process.env.GSTN_TIMEOUT_MS = "60";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["PFMS_MODE", "PFMS_AGENCY_CODE", "PFMS_AUTH_TOKEN", "PFMS_TIMEOUT_MS", "GSTN_MODE", "GSTN_CLIENT_ID", "GSTN_CLIENT_SECRET", "GSTN_GSTIN", "GSTN_TIMEOUT_MS"]) delete process.env[k];
});

const disburse = {
  txnRef: "T1", schemeCode: "S1", amountMinor: 10000n, currency: "INR" as const,
  beneficiary: { name: "A", bankAccount: "1", ifsc: "X" }, narration: "n",
};
const gstr1 = { period: "042026", invoices: [] };
const gstr3b = {
  period: "042026",
  outwardSupplies: { igstMinor: 0n, cgstMinor: 0n, sgstMinor: 0n, cessMinor: 0n },
  itcClaimed: { igstMinor: 0n, cgstMinor: 0n, sgstMinor: 0n, cessMinor: 0n },
};

describe("PFMS adapter timeouts", () => {
  it("disbursement times out with a typed error flagged outcome-unknown", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const m = await load("pfms");
    const err = await settle(m.initiateDisbursement(disburse));
    expect(err).toBeInstanceOf(m.PfmsTimeoutError);
    expect(err).toBeInstanceOf(m.PfmsAdapterError);
    expect(err).toMatchObject({ code: "PFMS_TIMEOUT", outcomeUnknown: true, timeoutMs: 60 });
  });

  it("status check times out with a typed, outcome-known error", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const m = await load("pfms");
    const err = await settle(m.checkDisbursementStatus({ pfmsTxnId: "P1" }));
    expect(err).toBeInstanceOf(m.PfmsTimeoutError);
    expect(err).toMatchObject({ code: "PFMS_TIMEOUT", outcomeUnknown: false });
  });
});

describe("GSTN adapter timeouts", () => {
  it("token fetch times out (typed, read-only)", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const m = await load("gstn");
    const err = await settle(m.checkFilingStatus("R1"));
    expect(err).toBeInstanceOf(m.GstnTimeoutError);
    expect(err).toMatchObject({ code: "GSTN_TIMEOUT", outcomeUnknown: false });
  });

  it("status check times out when the token succeeds but the status call hangs", async () => {
    const hang = hangingFetch();
    const f = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith("/oauth/token")
        ? Promise.resolve(new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 }))
        : hang(url, init));
    vi.stubGlobal("fetch", f);
    const m = await load("gstn");
    const err = await settle(m.checkFilingStatus("R1"));
    expect(err).toBeInstanceOf(m.GstnTimeoutError);
    expect(err).toMatchObject({ outcomeUnknown: false });
  });

  it.each([["GSTR-1", "fileGstr1", gstr1], ["GSTR-3B", "fileGstr3B", gstr3b]] as const)(
    "%s filing times out flagged outcome-unknown",
    async (_n, fn, req) => {
      const hang = hangingFetch();
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith("/oauth/token")
          ? Promise.resolve(new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 }))
          : hang(url, init)));
      const m = await load("gstn");
      const err = await settle(m[fn](req));
      expect(err).toBeInstanceOf(m.GstnTimeoutError);
      expect(err).toMatchObject({ code: "GSTN_TIMEOUT", outcomeUnknown: true });
    },
  );
});
