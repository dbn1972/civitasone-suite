/**
 * CLOS2-S6-12: every NIC e-way bill call is bounded by an AbortSignal timeout and a
 * stalled gateway surfaces a typed NicTimeoutError instead of hanging the consumer.
 * The stubbed fetch only settles when the request's AbortSignal fires.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      if (!init?.signal) return; // no signal => never settles (the pre-fix hang)
      init.signal.addEventListener("abort", () => rej(init.signal!.reason));
    }));
}
async function settle<T>(p: Promise<T>): Promise<unknown> {
  return Promise.race([
    p.then(() => "resolved", (e: unknown) => e),
    new Promise((r) => setTimeout(() => r("HUNG"), 1500)),
  ]);
}
async function load() {
  vi.resetModules();
  return import("../src/modules/eway-bill/nic-ewb-client.js");
}

beforeEach(() => {
  process.env.EWB_API_URL = "https://ewb.nic.test";
  process.env.EWB_TIMEOUT_MS = "60";
  vi.stubGlobal("fetch", hangingFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EWB_API_URL;
  delete process.env.EWB_TIMEOUT_MS;
});

const payload = {
  supplyType: "outward", subSupplyType: "supply", docType: "invoice", docNo: "INV-1", docDate: "2026-04-01",
  fromGstin: "29ABCDE1234F1Z5", fromName: "A", fromAddr: "a", fromPin: "560001", fromStateCode: "29",
  toName: "B", toAddr: "b", toPin: "560002", toStateCode: "29", totalValue: 100, hsnCode: "1001",
};

describe("NIC e-way bill client timeouts", () => {
  it("generateEwb times out with a typed error flagged outcome-unknown", async () => {
    const m = await load();
    const err = await settle(m.generateEwb(payload));
    expect(err).toBeInstanceOf(m.NicTimeoutError);
    expect(err).toMatchObject({ outcomeUnknown: true, timeoutMs: 60 });
    expect((err as Error).message).toMatch(/reconcile/);
  });

  it("cancelEwb and updateVehicle (writes) are flagged outcome-unknown", async () => {
    const m = await load();
    expect(await settle(m.cancelEwb("123456789012", "dup"))).toMatchObject({ name: "NicTimeoutError", outcomeUnknown: true });
    expect(await settle(m.updateVehicle("123456789012", "KA01AB1234"))).toMatchObject({ name: "NicTimeoutError", outcomeUnknown: true });
  });

  it("getEwb (read-only) times out as outcome-known", async () => {
    const m = await load();
    const err = await settle(m.getEwb("123456789012"));
    expect(err).toBeInstanceOf(m.NicTimeoutError);
    expect(err).toMatchObject({ outcomeUnknown: false });
  });
});
