/**
 * CLOS3-S4-07: every NIC e-invoice HTTP call must carry an AbortSignal timeout.
 * No DB, no secrets: global fetch is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const payload = {
  version: "1.1",
  docDtls: { typ: "INV", no: "INV0001", dt: "01/01/2026" },
} as never;

const authOk = () =>
  new Response(JSON.stringify({ authToken: "tok", tokenExpiry: 7200 }), { status: 200 });

/** fetch stub: call #n (1-based) in `hangOn` never settles unless its signal aborts. */
function stubFetch(hangOn: number[], okBody?: unknown) {
  let n = 0;
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    n += 1;
    if (hangOn.includes(n)) {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }
    if (n === 1) return Promise.resolve(authOk());
    return Promise.resolve(new Response(JSON.stringify(okBody ?? {}), { status: 200 }));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function load() {
  vi.resetModules();
  vi.stubEnv("EINVOICE_MODE", "live");
  vi.stubEnv("EINVOICE_API_URL", "http://nic.invalid");
  vi.stubEnv("EINVOICE_TIMEOUT_MS", "50");
  return import("../src/modules/einvoice/nic-client.js");
}

/** Race the call against a hard 1s guard so a missing timeout fails fast instead of hanging. */
async function settle(p: Promise<unknown>): Promise<"hung" | Error | unknown> {
  const guard = new Promise<"hung">((r) => setTimeout(() => r("hung"), 1000));
  return Promise.race([p.catch((e: Error) => e), guard]);
}

describe("CLOS3-S4-07 NIC client timeouts", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("auth call times out", async () => {
    stubFetch([1]);
    const nic = await load();
    const r = await settle(nic.generateIrn(payload));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("generateIrn times out", async () => {
    stubFetch([2]);
    const nic = await load();
    const r = await settle(nic.generateIrn(payload));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("cancelIrn times out", async () => {
    stubFetch([2]);
    const nic = await load();
    const r = await settle(nic.cancelIrn("irn1", "dup"));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("getIrnByDocNo times out", async () => {
    stubFetch([2]);
    const nic = await load();
    const r = await settle(nic.getIrnByDocNo("27AAAAA0000A1Z5", "INV0001", "2025-26"));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  /**
   * Headers arrive promptly but the body never resolves (ignores the abort signal
   * on purpose, so only the deadline can end the call). `stallOn` = fetch call #s.
   */
  function stubStalledBody(stallOn: number) {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        n += 1;
        if (n === stallOn) {
          const never = () => new Promise<never>(() => undefined);
          return Promise.resolve({ ok: true, status: 200, text: never, json: never } as unknown as Response);
        }
        return Promise.resolve(authOk());
      }),
    );
  }

  it("auth body stall times out", async () => {
    stubStalledBody(1);
    const nic = await load();
    const r = await settle(nic.generateIrn(payload));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("generateIrn body stall times out", async () => {
    stubStalledBody(2);
    const nic = await load();
    const r = await settle(nic.generateIrn(payload));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("cancelIrn body stall times out", async () => {
    stubStalledBody(2);
    const nic = await load();
    const r = await settle(nic.cancelIrn("irn1", "dup"));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("getIrnByDocNo body stall times out", async () => {
    stubStalledBody(2);
    const nic = await load();
    const r = await settle(nic.getIrnByDocNo("27AAAAA0000A1Z5", "INV0001", "2025-26"));
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).message).toMatch(/timed out/i);
  });

  it("happy path still maps the response and passes a signal", async () => {
    const f = stubFetch([], {
      Irn: "i", AckNo: "a", AckDt: "d", SignedInvoice: "s", SignedQRCode: "q",
    });
    const nic = await load();
    const r = (await nic.generateIrn(payload)) as { irn: string; signedQrCode: string };
    expect(r.irn).toBe("i");
    expect(r.signedQrCode).toBe("q");
    for (const call of f.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
