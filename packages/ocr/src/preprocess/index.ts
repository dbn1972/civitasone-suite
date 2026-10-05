/**
 * Page preprocessing for OCR (configurable steps) + input rasterisation.
 *
 * DEPENDENCY JUSTIFICATION / FOOTPRINT (added for GAP-ADMIN-BULK-SCAN-02; none of these existed in the repo):
 *  - `sharp` ^0.35 (Apache-2.0; bundles prebuilt libvips, LGPL-3 dynamically linked): the de-facto
 *    maintained Node imaging library; decodes PNG/JPEG/multipage-TIFF, rotate/threshold/median/trim at
 *    native speed with no system packages or node-gyp. ~1MB JS + ~18MB libvips + <1MB binding, per platform
 *    (only the host platform is installed by pnpm).
 *  - `pdfjs-dist` 4.10 (Apache-2.0) + `@napi-rs/canvas` (MIT; ~27MB prebuilt Skia per platform): PDF
 *    rasterisation and text-layer extraction, see ./pdf.ts for the alternatives that were rejected.
 *    pdfjs-dist is ~37MB on disk (it ships several builds; only legacy/build is loaded).
 *  Total new install footprint ~85MB per platform, server-side only (never bundled into apps/web).
 *
 * Step order: grayscale -> auto-orient (OSD) -> deskew -> contrast normalise -> denoise (median)
 *             -> binarise (Otsu) -> border crop.   Every step can be switched off in PreprocessConfig.
 */
import sharp from "sharp";
import type { PageImage } from "../types.js";
import type { OrientationDetector } from "./orient.js";
import {
  DEFAULT_PREPROCESS, binarise, cropBorders, estimateSkewDeg, rotateWhite,
  type PreprocessConfig, type PreprocessReport,
} from "./steps.js";

export * from "./steps.js";
export * from "./orient.js";
export * from "./detect.js";
export * from "./pdf.js";
export * from "./images.js";

export interface PreprocessedImage { data: Buffer; width: number; height: number; report: PreprocessReport }

/** Runs the configured preprocessing steps on one PNG/JPEG/TIFF page raster. Output is always PNG. */
export async function preprocessImage(
  input: Uint8Array,
  config: Partial<PreprocessConfig> = {},
  detector?: OrientationDetector | null,
): Promise<PreprocessedImage> {
  const cfg: PreprocessConfig = { ...DEFAULT_PREPROCESS, ...config };
  const report: PreprocessReport = { rotationDeg: 0, orientationDetected: false, skewDeg: 0, binarised: false, crop: null, steps: [] };
  let buf: Buffer = Buffer.from(input);
  const png = { compressionLevel: 1 } as const;

  if (cfg.grayscale || cfg.binarise) {
    buf = await sharp(buf).greyscale().toColourspace("b-w").png(png).toBuffer();
    report.steps.push("grayscale");
  }

  if (cfg.autoOrient && detector) {
    const small = await sharp(buf).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png(png).toBuffer();
    const o = await detector.detect(small);
    report.orientationDetected = o !== null;
    if (o && o.degrees !== 0 && o.confidence >= cfg.orientationMinConfidence) {
      buf = await sharp(buf).rotate(o.degrees, { background: "#ffffff" }).png(png).toBuffer();
      report.rotationDeg = o.degrees;
      report.steps.push("orient");
    }
  }

  if (cfg.deskew) {
    const skew = await estimateSkewDeg(buf, cfg.maxSkewDeg);
    if (Math.abs(skew) >= cfg.minSkewDeg) {
      buf = await rotateWhite(buf, -skew);
      report.skewDeg = skew;
      report.steps.push("deskew");
    }
  }

  if (cfg.normalise || cfg.denoise) {
    let p = sharp(buf);
    if (cfg.normalise) { p = p.normalise(); report.steps.push("normalise"); }
    if (cfg.denoise) { p = p.median(3); report.steps.push("denoise"); }
    if (cfg.grayscale || cfg.binarise) p = p.toColourspace("b-w"); // normalise() round-trips through LAB/sRGB
    buf = await p.png(png).toBuffer();
  }

  if (cfg.binarise) {
    buf = await binarise(buf);
    report.binarised = true;
    report.steps.push("binarise");
  }

  if (cfg.cropBorder) {
    const before = await sharp(buf).metadata();
    const cropped = await cropBorders(buf, cfg.cropPaddingPx);
    if (cropped) {
      report.crop = { from: { width: before.width ?? 0, height: before.height ?? 0 }, to: { width: cropped.width, height: cropped.height } };
      buf = cropped.data;
      report.steps.push("crop");
    }
  }

  const meta = await sharp(buf).metadata();
  return { data: buf, width: meta.width ?? 0, height: meta.height ?? 0, report };
}

/** Wraps raw image bytes as a PageImage (sniffs mime + size). Used by callers that already hold a clean page image. */
export async function toPageImage(data: Uint8Array, pageNumber = 1, dpi = 300): Promise<PageImage> {
  const meta = await sharp(data).metadata();
  const fmt = meta.format;
  const mimeType = fmt === "jpeg" ? "image/jpeg" : fmt === "tiff" ? "image/tiff" : "image/png";
  return { pageNumber, data, mimeType, width: meta.width ?? 0, height: meta.height ?? 0, dpi };
}
