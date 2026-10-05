import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { estimateSkewDeg, preprocessImage, type OrientationDetector } from "../src/preprocess/index.js";
import { syntheticTextPng } from "./helpers.js";

const rotated = async (deg: number): Promise<Buffer> =>
  sharp(await syntheticTextPng({ width: 900, height: 600 })).rotate(deg, { background: "#ffffff" }).png().toBuffer();

async function distinctLevels(png: Uint8Array): Promise<number> {
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return new Set(data).size;
}

describe("deskew", () => {
  it("estimates clockwise skew (both directions) and ~0 for straight pages", async () => {
    expect(Math.abs((await estimateSkewDeg(await rotated(4))) - 4)).toBeLessThanOrEqual(0.6);
    expect(Math.abs((await estimateSkewDeg(await rotated(-3))) + 3)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(await estimateSkewDeg(await syntheticTextPng({ width: 900, height: 600 })))).toBeLessThanOrEqual(0.3);
  });

  it("reduces the residual skew after the deskew step", async () => {
    const skewed = await rotated(5);
    const before = Math.abs(await estimateSkewDeg(skewed));
    const out = await preprocessImage(skewed, { autoOrient: false, binarise: false, cropBorder: false, normalise: false, denoise: false });
    const after = Math.abs(await estimateSkewDeg(out.data));
    expect(before).toBeGreaterThan(3);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(0.6);
    expect(Math.abs(out.report.skewDeg - 5)).toBeLessThanOrEqual(0.6);
    expect(out.report.steps).toContain("deskew");
  });

  it("leaves a straight page alone", async () => {
    const out = await preprocessImage(await syntheticTextPng(), { autoOrient: false, binarise: false, cropBorder: false });
    expect(out.report.skewDeg).toBe(0);
    expect(out.report.steps).not.toContain("deskew");
  });
});

describe("tonal steps", () => {
  it("grayscale yields a single channel", async () => {
    const colour = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
    const out = await preprocessImage(colour, { autoOrient: false, deskew: false, binarise: false, cropBorder: false });
    expect((await sharp(out.data).metadata()).channels).toBe(1);
  });

  it("binarise yields exactly 2 levels, even from noisy grey input", async () => {
    const base = await syntheticTextPng();
    const noisy = await sharp(base).blur(1.2).linear(0.7, 40).png().toBuffer();
    expect(await distinctLevels(noisy)).toBeGreaterThan(2);
    const out = await preprocessImage(noisy, { autoOrient: false, deskew: false, cropBorder: false });
    expect(out.report.binarised).toBe(true);
    expect(await distinctLevels(out.data)).toBe(2);
  });

  it("median denoise removes salt-and-pepper specks", async () => {
    const w = 200, h = 200;
    const raw = Buffer.alloc(w * h, 255);
    for (let i = 0; i < 400; i++) raw[(i * 97) % raw.length] = 0; // isolated black specks
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    const out = await preprocessImage(png, { autoOrient: false, deskew: false, binarise: false, cropBorder: false, normalise: false });
    const { data } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(data.filter((v) => v < 128).length).toBeLessThan(10);
  });
});

describe("border crop", () => {
  it("shrinks a page with wide white margins", async () => {
    const src = await syntheticTextPng({ width: 900, height: 700, margin: 120 });
    const out = await preprocessImage(src, { autoOrient: false, deskew: false });
    expect(out.report.crop).not.toBeNull();
    expect(out.width).toBeLessThan(900);
    expect(out.height).toBeLessThan(700);
    expect(out.report.steps).toContain("crop");
  });

  it("removes dark scanner borders", async () => {
    const src = await syntheticTextPng({ width: 900, height: 700, blackBorder: 60 });
    const out = await preprocessImage(src, { autoOrient: false, deskew: false });
    expect(out.height).toBeLessThan(700 - 60);
  });

  it("refuses to crop a blank page to nothing", async () => {
    const blank = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const out = await preprocessImage(blank, { autoOrient: false, deskew: false });
    expect(out.width).toBe(300);
    expect(out.report.crop).toBeNull();
  });
});

describe("auto-orient", () => {
  const detector = (degrees: 0 | 90 | 180 | 270, confidence: number): OrientationDetector => ({
    detect: async () => ({ degrees, confidence, script: "Latin" }),
    dispose: async () => undefined,
  });

  it("rotates by the detected clockwise angle", async () => {
    const src = await syntheticTextPng({ width: 800, height: 600 });
    const out = await preprocessImage(src, { deskew: false, binarise: false, cropBorder: false }, detector(90, 4));
    expect(out.width).toBe(600);
    expect(out.height).toBe(800);
    expect(out.report).toMatchObject({ rotationDeg: 90, orientationDetected: true });
  });

  it("ignores low-confidence verdicts and a missing detector", async () => {
    const src = await syntheticTextPng({ width: 800, height: 600 });
    const low = await preprocessImage(src, { deskew: false, binarise: false, cropBorder: false }, detector(90, 0.5));
    expect(low.width).toBe(800);
    expect(low.report.rotationDeg).toBe(0);
    const none = await preprocessImage(src, { deskew: false, binarise: false, cropBorder: false }, null);
    expect(none.report.orientationDetected).toBe(false);
  });
});

describe("steps are switchable", () => {
  it("with everything off the page is passed through (re-encoded) untouched", async () => {
    const src = await syntheticTextPng({ width: 400, height: 300, margin: 50 });
    const out = await preprocessImage(src, { autoOrient: false, deskew: false, grayscale: false, normalise: false, denoise: false, binarise: false, cropBorder: false });
    expect(out.report.steps).toEqual([]);
    expect([out.width, out.height]).toEqual([400, 300]);
  });
});
