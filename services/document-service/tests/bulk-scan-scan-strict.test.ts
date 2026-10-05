/** Fail-closed malware verdict: only an explicit clean body is "clean" (the shared scanner client fails open on any 200). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { scanStrict, classifyScanBody } from "../src/modules/bulk-scan/scan-strict.js";
import { getPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";

const reply = (status: number, body: string): typeof fetch => (async () => new Response(body, { status })) as unknown as typeof fetch;
const scan = (f: typeof fetch) => scanStrict(Buffer.from("x"), "a.pdf", { url: "http://scanner.test/scan", fetchImpl: f });

afterEach(() => { vi.unstubAllGlobals(); resetPorts(); });

describe("scanStrict (positive-clean evidence)", () => {
  it("explicit clean -> clean", async () => {
    expect(await scan(reply(200, JSON.stringify({ infected: false })))).toBe("clean");
    expect(await scan(reply(200, JSON.stringify({ status: "clean" })))).toBe("clean");
    expect(await scan(reply(200, JSON.stringify({ infected: false, status: "clean" })))).toBe("clean");      // the shape the repo's own scanner mocks return
  });
  it("explicit infected -> infected (also when the body contradicts itself)", async () => {
    expect(await scan(reply(200, JSON.stringify({ infected: true })))).toBe("infected");
    expect(await scan(reply(200, JSON.stringify({ status: "infected" })))).toBe("infected");
    expect(await scan(reply(200, JSON.stringify({ infected: true, status: "clean" })))).toBe("infected");
  });
  it("a bare health-style {status:'ok'} (or OK / Ok), a capitalised ClamAV-REST body and other statuses are NOT clean", async () => {
    for (const b of [{ status: "ok" }, { status: "OK" }, { infected: false, status: "ok" }, { Status: "OK" }, { status: "Clean" }, { status: "CLEAN" }, { infected: false, status: "pending" }]) {
      expect(await scan(reply(200, JSON.stringify(b))), JSON.stringify(b)).toBe("error");
    }
  });
  it("a redirect is never followed or trusted", async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: string, o: RequestInit) => { seen = o; return new Response(JSON.stringify({ infected: false }), { status: 302 }); }) as unknown as typeof fetch;
    expect(await scan(f)).toBe("error");
    expect(seen?.redirect).toBe("manual");
  });
  it("empty body -> error", async () => { expect(await scan(reply(200, ""))).toBe("error"); });
  it("non-JSON body -> error", async () => { expect(await scan(reply(200, "<html>proxy</html>"))).toBe("error"); });
  it("unexpected JSON shape -> error", async () => {
    for (const b of [{}, { status: "error" }, { Status: "FOUND" }, { infected: "no" }, { infected: false, status: "weird" }, [], "clean", null, 7]) {
      expect(await scan(reply(200, JSON.stringify(b))), JSON.stringify(b)).toBe("error");
    }
  });
  it("non-200 -> error (even with a clean-looking body)", async () => {
    expect(await scan(reply(500, JSON.stringify({ infected: false })))).toBe("error");
    expect(await scan(reply(204, ""))).toBe("error");
    expect(await scan(reply(404, JSON.stringify({ status: "clean" })))).toBe("error");
  });
  it("network failure / timeout -> error", async () => {
    expect(await scan((async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe("error");
    const hang = ((_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await scanStrict(Buffer.from("x"), "a", { url: "http://x/scan", timeoutMs: 20, fetchImpl: hang })).toBe("error");
  });
  it("classifyScanBody is total", () => { expect(classifyScanBody(undefined)).toBe("error"); });
});

describe("default bulk-scan scanner port", () => {
  it("a 200 with an unexpected body is NOT clean (scanFile would have said clean)", async () => {
    vi.stubGlobal("fetch", reply(200, JSON.stringify({ status: "error" })));
    expect(await getPorts().scanner.scan(Buffer.from("x"), "a.pdf")).toBe("error");
    vi.stubGlobal("fetch", reply(200, JSON.stringify({ infected: false })));
    expect(await getPorts().scanner.scan(Buffer.from("x"), "a.pdf")).toBe("clean");
  });
});
