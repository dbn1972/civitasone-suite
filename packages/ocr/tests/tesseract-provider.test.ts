import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TesseractProvider, toPageResult, type TessPageLike, type TessWorkerFactory, type TessWorkerLike } from "../src/providers/tesseract.js";
import { OcrProviderError } from "../src/types.js";
import { fakePage } from "./helpers.js";

const pageData = (text: string, conf = 90): TessPageLike => ({
  text,
  confidence: conf,
  blocks: [{
    text, confidence: conf, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
    paragraphs: [{ lines: [{ text, confidence: conf, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 }, words: text.split(" ").map((w, i) => ({ text: w, confidence: conf - i * 10, bbox: { x0: i * 10, y0: 0, x1: i * 10 + 9, y1: 20 } })) }] }],
  }],
});

function harness(delayMs = 15) {
  const state = { created: 0, live: 0, maxLive: 0, inFlight: 0, maxInFlight: 0, reinit: [] as string[], terminated: 0, created_langs: [] as string[] };
  const factory: TessWorkerFactory = async (langs) => {
    state.created++; state.live++; state.created_langs.push(langs);
    state.maxLive = Math.max(state.maxLive, state.live);
    const w: TessWorkerLike = {
      recognize: async () => {
        state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        await new Promise((r) => setTimeout(r, delayMs));
        state.inFlight--;
        return { data: pageData("hello brave world") };
      },
      reinitialize: async (l) => { state.reinit.push(l); },
      terminate: async () => { state.live--; state.terminated++; },
    };
    return w;
  };
  return { state, factory };
}

describe("TesseractProvider pool", () => {
  it("never exceeds maxWorkers concurrent recognitions or live workers", async () => {
    const h = harness();
    const p = new TesseractProvider({ maxWorkers: 2, workerFactory: h.factory, idleTimeoutMs: 0 });
    const pages = Array.from({ length: 9 }, (_, i) => fakePage(i + 1));
    const out = await p.recognize(pages, { langs: ["eng"] });
    expect(out).toHaveLength(9);
    expect(out.map((r) => r.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.state.maxInFlight).toBeLessThanOrEqual(2);
    expect(h.state.maxLive).toBeLessThanOrEqual(2);
    expect(h.state.maxInFlight).toBe(2); // parallelism is actually used
    await p.dispose();
    expect(h.state.live).toBe(0);
  });

  it("serialises across concurrent recognize() calls (bound is pool-wide) and reinitialises for another language set", async () => {
    const h = harness(10);
    const p = new TesseractProvider({ maxWorkers: 1, workerFactory: h.factory, idleTimeoutMs: 0 });
    await Promise.all([
      p.recognize([fakePage(1), fakePage(2)], { langs: ["eng"] }),
      p.recognize([fakePage(1)], { langs: ["eng", "hin"] }),
    ]);
    expect(h.state.maxInFlight).toBe(1);
    expect(h.state.created).toBe(1);
    expect(h.state.reinit).toContain("eng+hin");
    await p.dispose();
  });

  it("maps results: confidence normalised to 0..1, mean over words, script detected", async () => {
    const r = toPageResult(fakePage(3), pageData("hello brave world", 90), { totalMs: 5, recognizeMs: 4 });
    expect(r.pageNumber).toBe(3);
    expect(r.providerId).toBe("tesseract");
    expect(r.source).toBe("ocr");
    expect(r.script).toBe("Latin");
    const words = r.blocks[0]?.lines[0]?.words ?? [];
    expect(words.map((w) => w.confidence)).toEqual([0.9, 0.8, 0.7]);
    expect(r.meanConfidence).toBeCloseTo(0.8, 5);
    const dev = toPageResult(fakePage(1), pageData("नमस्ते दुनिया", 80), { totalMs: 1, recognizeMs: 1 });
    expect(dev.script).toBe("Devanagari");
    expect(toPageResult(fakePage(1), { text: "", confidence: 0, blocks: null }, { totalMs: 0, recognizeMs: 0 }).meanConfidence).toBe(0);
  });

  it("rejects unsupported languages and names the language when local traineddata is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bulk-scan-01-td-"));
    await writeFile(join(dir, "eng.traineddata"), "x");
    const h = harness();
    const p = new TesseractProvider({ workerFactory: h.factory, tessdataPath: dir });
    await expect(p.recognize([fakePage(1)], { langs: ["eng", "hin"] })).rejects.toThrow(/language "hin" is unavailable/);
    await expect(p.recognize([fakePage(1)], { langs: ["eng", "hin"] })).rejects.toBeInstanceOf(OcrProviderError);
    await expect(p.recognize([fakePage(1)], { langs: ["xx" as never] })).rejects.toThrow(/Unsupported OCR language "xx"/);
    await expect(p.recognize([fakePage(1)], { langs: ["eng"] })).resolves.toHaveLength(1);
    expect(h.state.created_langs).toEqual(["eng"]);
    await p.dispose();
  });

  it("wraps worker-creation failures (e.g. URL source unreachable) naming the language", async () => {
    const p = new TesseractProvider({ tessdataPath: "https://tessdata.example.invalid", workerFactory: async () => { throw new Error("ENOTFOUND"); } });
    await expect(p.recognize([fakePage(1)], { langs: ["tam"] })).rejects.toThrow(/language\(s\) tam.*ENOTFOUND/);
    expect(p.workerCount).toBe(0);
  });

  it("discards a worker whose recognition failed and surfaces a retryable error", async () => {
    let n = 0;
    const factory: TessWorkerFactory = async () => ({
      recognize: async () => { if (n++ === 0) throw new Error("wasm abort"); return { data: pageData("ok ok") }; },
      reinitialize: async () => undefined, terminate: async () => undefined,
    });
    const p = new TesseractProvider({ maxWorkers: 1, workerFactory: factory, idleTimeoutMs: 0 });
    await expect(p.recognize([fakePage(1)], { langs: ["eng"] })).rejects.toThrow(/wasm abort/);
    expect(p.workerCount).toBe(0);
    await expect(p.recognize([fakePage(1)], { langs: ["eng"] })).resolves.toHaveLength(1);
    await p.dispose();
  });
});
