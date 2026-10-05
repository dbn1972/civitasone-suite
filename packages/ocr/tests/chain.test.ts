import { describe, expect, it } from "vitest";
import { OcrChain } from "../src/chain.js";
import { OcrChainError } from "../src/errors.js";
import { GoogleDocAiProvider } from "../src/providers/cloud.js";
import { OcrProviderError } from "../src/types.js";
import { fakePage, fakeProvider, pageResult } from "./helpers.js";

const pages = [fakePage(1), fakePage(2)];
const ok = (conf: number, id: "tesseract" | "google_docai" = "tesseract") => (_c: number, ps: typeof pages) => ps.map((p) => pageResult(p, conf, id));

function clock() {
  const sleeps: number[] = [];
  return { sleeps, random: () => 0.5, sleep: async (ms: number) => { sleeps.push(ms); } };
}

describe("OcrChain fallback", () => {
  it("uses the primary when it succeeds and never calls the secondary", async () => {
    const a = fakeProvider("tesseract", ok(0.9));
    const b = fakeProvider("google_docai", ok(0.9, "google_docai"));
    const chain = new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"] });
    const r = await chain.recognize(pages);
    expect(r.providerIds).toEqual(["tesseract"]);
    expect(r.pageCount).toBe(2);
    expect(b.calls).toHaveLength(0);
    expect(r.text).toContain("\f");
  });

  it("falls back to the next provider on failure", async () => {
    const a = fakeProvider("tesseract", () => { throw new OcrProviderError("tesseract", "boom", false); });
    const b = fakeProvider("google_docai", ok(0.8, "google_docai"));
    const chain = new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"], clock: clock() });
    const r = await chain.recognize(pages);
    expect(r.providerIds).toEqual(["google_docai"]);
    expect(r.diagnostics?.map((d) => d.outcome)).toEqual(["failed", "ok"]);
    expect(r.diagnostics?.[0]?.error).toBe("boom");
  });

  it("skips providers reporting unavailable and throws OcrChainError when none work", async () => {
    const a = fakeProvider("tesseract", ok(0.9), false);
    const chain = new OcrChain({ providers: [{ provider: a }], langs: ["eng"] });
    await expect(chain.recognize(pages)).rejects.toBeInstanceOf(OcrChainError);
    expect(a.calls).toHaveLength(0);
  });

  it("falls back from a production cloud stub (NotImplemented) without retrying it", async () => {
    const prod = new GoogleDocAiProvider({ mode: "production" });
    // force it to be treated as available so we exercise the NotImplemented error path in the chain
    const forced = Object.assign(Object.create(prod) as GoogleDocAiProvider, { isAvailable: async () => true });
    let calls = 0;
    const counting = { id: forced.id, isAvailable: async () => true, dispose: async () => undefined, recognize: (p: typeof pages, o: Parameters<typeof forced.recognize>[1]) => { calls++; return forced.recognize(p, o); } };
    const b = fakeProvider("tesseract", ok(0.7));
    const chain = new OcrChain({ providers: [{ provider: counting, maxAttempts: 3 }, { provider: b }], langs: ["eng"], clock: clock() });
    const r = await chain.recognize(pages);
    expect(calls).toBe(1);
    expect(r.providerIds).toEqual(["tesseract"]);
    expect(r.diagnostics?.[0]?.error).toMatch(/google_docai/);
  });
});

describe("OcrChain retry / backoff", () => {
  it("retries with deterministic jittered exponential backoff", async () => {
    const c = clock();
    const a = fakeProvider("tesseract", (call, ps) => {
      if (call < 2) throw new Error("transient");
      return ps.map((p) => pageResult(p, 0.9));
    });
    const chain = new OcrChain({ providers: [{ provider: a, maxAttempts: 3, backoffBaseMs: 100, backoffMaxMs: 150 }], langs: ["eng"], clock: c });
    const r = await chain.recognize(pages);
    expect(a.calls).toHaveLength(3);
    // random()=0.5 => factor 0.75: attempt1 100*0.75=75 ; attempt2 min(150,200)=150*0.75=113 (rounded)
    expect(c.sleeps).toEqual([75, 113]);
    expect(r.diagnostics?.[0]).toMatchObject({ outcome: "ok", attempts: 3 });
  });

  it("does not retry non-retryable provider errors", async () => {
    const c = clock();
    const a = fakeProvider("tesseract", () => { throw new OcrProviderError("tesseract", "no data for hin", false); });
    const chain = new OcrChain({ providers: [{ provider: a, maxAttempts: 4 }], langs: ["eng"], clock: c });
    await expect(chain.recognize(pages)).rejects.toThrow(/no data for hin/);
    expect(a.calls).toHaveLength(1);
    expect(c.sleeps).toEqual([]);
  });
});

describe("OcrChain circuit breaker", () => {
  it("opens after the threshold and then skips the provider without calling it", async () => {
    const a = fakeProvider("tesseract", () => { throw new Error("down"); });
    const b = fakeProvider("google_docai", ok(0.8, "google_docai"));
    const chain = new OcrChain({
      providers: [{ provider: a, maxAttempts: 1, breaker: { failureThreshold: 2, recoveryMs: 60_000 } }, { provider: b }],
      langs: ["eng"], clock: clock(),
    });
    await chain.recognize(pages);
    await chain.recognize(pages);
    expect(a.calls).toHaveLength(2);
    expect(chain.breakerStates().tesseract).toBe("open");
    const r = await chain.recognize(pages);
    expect(a.calls).toHaveLength(2); // not invoked: circuit open
    expect(r.diagnostics?.[0]?.outcome).toBe("circuit_open");
    expect(r.providerIds).toEqual(["google_docai"]);
  });
});

describe("OcrChain timeout", () => {
  it("aborts a hung provider via AbortSignal and falls back", async () => {
    let seen: AbortSignal | undefined;
    const a = fakeProvider("tesseract", (_c, _p, o) => { seen = o.signal; return new Promise(() => undefined); });
    const b = fakeProvider("google_docai", ok(0.8, "google_docai"));
    const chain = new OcrChain({ providers: [{ provider: a, timeoutMs: 25, maxAttempts: 1 }, { provider: b }], langs: ["eng"], clock: clock() });
    const r = await chain.recognize(pages);
    expect(seen?.aborted).toBe(true);
    expect(r.diagnostics?.[0]?.outcome).toBe("timeout");
    expect(r.providerIds).toEqual(["google_docai"]);
  });
});

describe("OcrChain best-of", () => {
  it("re-runs only low-confidence pages on the next provider and keeps the higher-confidence page", async () => {
    const a = fakeProvider("tesseract", (_c, ps) => ps.map((p) => pageResult(p, p.pageNumber === 1 ? 0.4 : 0.95)));
    const b = fakeProvider("google_docai", (_c, ps) => ps.map((p) => pageResult(p, 0.85, "google_docai", "better")));
    const chain = new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"], bestOf: { enabled: true, threshold: 0.7 } });
    const r = await chain.recognize(pages);
    expect(b.calls[0]?.pages).toEqual([1]);
    expect(r.pages[0]).toMatchObject({ providerId: "google_docai", meanConfidence: 0.85, text: "better" });
    expect(r.pages[1]?.providerId).toBe("tesseract");
    expect(r.providerIds).toEqual(["google_docai", "tesseract"]);
  });

  it("keeps the primary page when the next provider is not better, and ignores a failing best-of provider", async () => {
    const a = fakeProvider("tesseract", (_c, ps) => ps.map((p) => pageResult(p, 0.5)));
    const b = fakeProvider("google_docai", (_c, ps) => ps.map((p) => pageResult(p, 0.3, "google_docai")));
    const chain = new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"], bestOf: { enabled: true, threshold: 0.9 } });
    const r = await chain.recognize(pages);
    expect(r.providerIds).toEqual(["tesseract"]);
    expect(r.diagnostics?.map((d) => d.outcome)).toEqual(["ok", "best_of_kept"]);

    const failing = fakeProvider("google_docai", () => { throw new OcrProviderError("google_docai", "x", false); });
    const chain2 = new OcrChain({ providers: [{ provider: a }, { provider: failing }], langs: ["eng"], bestOf: { enabled: true, threshold: 0.9 } });
    const r2 = await chain2.recognize(pages);
    expect(r2.providerIds).toEqual(["tesseract"]);
  });

  it("does nothing extra when best-of is off or confidence is above threshold", async () => {
    const a = fakeProvider("tesseract", ok(0.5));
    const b = fakeProvider("google_docai", ok(0.99, "google_docai"));
    await new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"] }).recognize(pages);
    await new OcrChain({ providers: [{ provider: a }, { provider: b }], langs: ["eng"], bestOf: { enabled: true, threshold: 0.4 } }).recognize(pages);
    expect(b.calls).toHaveLength(0);
  });
});

describe("OcrChain caller abort vs circuit breaker", () => {
  const hang = (_c: number, _p: typeof pages, _o: unknown) => new Promise<never>(() => undefined);

  it("repeated caller aborts never open the breaker (threshold 2), while timeouts still do", async () => {
    const a = fakeProvider("tesseract", hang as never);
    const chain = new OcrChain({ providers: [{ provider: a, maxAttempts: 1, timeoutMs: 60_000, breaker: { failureThreshold: 2, recoveryMs: 60_000 } }], langs: ["eng"], clock: clock() });
    for (let i = 0; i < 5; i++) {
      const ac = new AbortController();
      const run = chain.recognize(pages, { signal: ac.signal });
      setTimeout(() => ac.abort(), 5);
      await expect(run).rejects.toBeInstanceOf(OcrChainError);
    }
    expect(chain.breakerStates().tesseract).toBe("closed");

    const slow = fakeProvider("tesseract", hang as never);
    const chain2 = new OcrChain({ providers: [{ provider: slow, maxAttempts: 1, timeoutMs: 10, breaker: { failureThreshold: 2, recoveryMs: 60_000 } }], langs: ["eng"], clock: clock() });
    for (let i = 0; i < 2; i++) await expect(chain2.recognize(pages)).rejects.toBeInstanceOf(OcrChainError);
    expect(chain2.breakerStates().tesseract).toBe("open");
  });

  it("an abort between failures does not advance or reset the consecutive-failure count", async () => {
    let n = 0;
    const flaky = fakeProvider("tesseract", ((_c: number, _p: typeof pages) => { n++; if (n === 2) return new Promise<never>(() => undefined); throw new OcrProviderError("tesseract", "boom", false); }) as never);
    const chain = new OcrChain({ providers: [{ provider: flaky, maxAttempts: 1, breaker: { failureThreshold: 2, recoveryMs: 60_000 } }], langs: ["eng"], clock: clock() });
    await expect(chain.recognize(pages)).rejects.toBeInstanceOf(OcrChainError); // failure 1
    const ac = new AbortController();
    const run = chain.recognize(pages, { signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    await expect(run).rejects.toBeInstanceOf(OcrChainError);                    // aborted: not counted
    expect(chain.breakerStates().tesseract).toBe("closed");
    await expect(chain.recognize(pages)).rejects.toBeInstanceOf(OcrChainError); // failure 2 => open
    expect(chain.breakerStates().tesseract).toBe("open");
  });
});
