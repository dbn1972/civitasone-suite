import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPageResult, type TessPageLike } from "../src/providers/tesseract.js";
import { writeFileAtomic } from "../src/fixtures/index.js";
import { FONT_SHA256, FontDigestError, sha256Hex, verifyAndInstall } from "../scripts/font-verify.mjs";
import { fakePage } from "./helpers.js";

const BBOX = { x0: 0, y0: 0, x1: 1, y1: 1 };
const pageWith = (text: string): TessPageLike => ({
  text, confidence: 90,
  blocks: [{ text, confidence: 90, bbox: BBOX, paragraphs: [{ lines: [{ text, confidence: 90, bbox: BBOX, words: [{ text: "x", confidence: 90, bbox: BBOX }] }] }] }],
});

describe("toPageResult trailing-whitespace trim is linear (no polynomial ReDoS)", () => {
  const N = 200_000;
  it("adversarial whitespace runs ending in a non-space finish fast and keep the text intact", () => {
    for (const ws of [" ", "\t", "\u00a0", "\u2003", " \t"]) {
      const text = `a${ws.repeat(N)}b`;
      const t0 = performance.now();
      const r = toPageResult(fakePage(1), pageWith(text), { totalMs: 1, recognizeMs: 1 });
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(200);
      expect(r.blocks[0]?.text).toBe(text);
      expect(r.blocks[0]?.lines[0]?.text).toBe(text);
    }
  });
  it("trailing whitespace is still stripped (behaviour unchanged)", () => {
    const r = toPageResult(fakePage(1), pageWith("hello \t\n  "), { totalMs: 1, recognizeMs: 1 });
    expect(r.blocks[0]?.text).toBe("hello");
    expect(r.blocks[0]?.lines[0]?.text).toBe("hello");
    const big = toPageResult(fakePage(1), pageWith(`hello${" ".repeat(N)}`), { totalMs: 1, recognizeMs: 1 });
    expect(big.blocks[0]?.text).toBe("hello");
  });
  it("digit/dot/dash runs with near-miss endings are untouched", () => {
    for (const run of ["1", ".", "-"]) {
      const text = `${run.repeat(N)} x`;
      const t0 = performance.now();
      const r = toPageResult(fakePage(1), pageWith(text), { totalMs: 1, recognizeMs: 1 });
      expect(performance.now() - t0).toBeLessThan(200);
      expect(r.blocks[0]?.text).toBe(text);
    }
  });
});

describe("font download verification (offline, local fake bytes)", () => {
  const bytes = new Uint8Array(Buffer.from("fake font bytes ".repeat(100)));
  const name = "NotoSansLatin-Regular.ttf";
  const leftovers = async (): Promise<string[]> => (await readdir(tmpdir())).filter((n) => n.startsWith("bulk-scan-01-font-"));

  it("installs only when the pinned SHA-256 matches, atomically, without leaving staging dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bulk-scan-01-fontdir-"));
    try {
      const before = (await leftovers()).length;
      const p = await verifyAndInstall(dir, name, bytes, { [name]: sha256Hex(bytes) });
      expect(p).toBe(join(dir, name));
      expect(Buffer.compare(await readFile(p), Buffer.from(bytes))).toBe(0);
      expect((await leftovers()).length).toBe(before);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("REFUSES a digest mismatch: nothing at the final path, staging deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bulk-scan-01-fontdir-"));
    try {
      const before = (await leftovers()).length;
      await expect(verifyAndInstall(dir, name, bytes, { [name]: "0".repeat(64) })).rejects.toThrow(FontDigestError);
      await expect(stat(join(dir, name))).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
      expect((await leftovers()).length).toBe(before);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("REFUSES a font with no pinned digest and an unsafe file name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bulk-scan-01-fontdir-"));
    try {
      await expect(verifyAndInstall(dir, name, bytes, { [name]: null })).rejects.toThrow(/no pinned SHA-256/);
      await expect(verifyAndInstall(dir, "../evil.ttf", bytes, { "../evil.ttf": sha256Hex(bytes) })).rejects.toThrow(FontDigestError);
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("the pin map covers every font file name the fetch script writes", () => {
    expect(Object.keys(FONT_SHA256).sort()).toEqual([
      "NotoNaskhArabic-Regular.ttf", "NotoSansBengali-Regular.ttf", "NotoSansDevanagari-Regular.ttf", "NotoSansGujarati-Regular.ttf",
      "NotoSansGurmukhi-Regular.ttf", "NotoSansKannada-Regular.ttf", "NotoSansLatin-Regular.ttf", "NotoSansMalayalam-Regular.ttf",
      "NotoSansOdia-Regular.ttf", "NotoSansTamil-Regular.ttf", "NotoSansTelugu-Regular.ttf",
    ]);
  });
});

describe("writeFileAtomic (fixture / tessdata downloads)", () => {
  it("writes via private staging then rename, replacing any existing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bulk-scan-01-atomic-"));
    try {
      const target = join(dir, "sub");
      const p = await writeFileAtomic(target, "f.bin", new Uint8Array([1, 2, 3]));
      expect([...(await readFile(p))]).toEqual([1, 2, 3]);
      await writeFileAtomic(target, "f.bin", new Uint8Array([9]));
      expect([...(await readFile(p))]).toEqual([9]);
      expect(await readdir(target)).toEqual(["f.bin"]);
      expect(((await stat(target)).mode & 0o777)).toBe(0o700);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
