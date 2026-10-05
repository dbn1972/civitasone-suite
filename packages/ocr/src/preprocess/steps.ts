import sharp, { type OutputInfo } from "sharp";

export interface PreprocessConfig {
  /** DPI used when rasterising PDFs, and the assumed DPI of images with no density metadata. Default 300. */
  dpi: number;
  autoOrient: boolean;
  deskew: boolean;
  grayscale: boolean;
  /** Contrast stretch to the full tonal range. */
  normalise: boolean;
  /** 3x3 median filter (salt-and-pepper noise). */
  denoise: boolean;
  /** Otsu global threshold => strictly 2 levels (0/255). */
  binarise: boolean;
  /** Trim scanner borders and surplus margins. */
  cropBorder: boolean;
  /** Skew search window (degrees, +/-). Default 10. */
  maxSkewDeg: number;
  /** Ignore skew below this (degrees). Default 0.2. */
  minSkewDeg: number;
  /** Minimum OSD orientation confidence to act on. Default 2. */
  orientationMinConfidence: number;
  /** White padding re-added around the cropped content (px). Default 12. */
  cropPaddingPx: number;
}

export const DEFAULT_PREPROCESS: PreprocessConfig = {
  dpi: 300, autoOrient: true, deskew: true, grayscale: true, normalise: true, denoise: true,
  binarise: true, cropBorder: true, maxSkewDeg: 10, minSkewDeg: 0.2, orientationMinConfidence: 2, cropPaddingPx: 12,
};

export interface PreprocessReport {
  rotationDeg: 0 | 90 | 180 | 270;
  /** True when an orientation detector produced a verdict (even "already upright"). */
  orientationDetected: boolean;
  /** Detected content skew (degrees clockwise) that was corrected; 0 if none/skipped. */
  skewDeg: number;
  binarised: boolean;
  crop: { from: { width: number; height: number }; to: { width: number; height: number } } | null;
  steps: string[];
}

const fastPng = { compressionLevel: 1 } as const;

/** Otsu threshold (0..255) from a 256-bin histogram. */
export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * (hist[i] ?? 0);
  let wB = 0, sumB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

async function greyRaw(png: Uint8Array, maxWidth: number): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).greyscale().toColourspace("b-w").resize({ width: maxWidth, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Estimates content skew in degrees CLOCKWISE (positive = text baselines slope downward to the right)
 * with a projection-profile search over [-maxDeg, +maxDeg]. Returns 0 when there is no clear signal.
 */
export async function estimateSkewDeg(png: Uint8Array, maxDeg = 10): Promise<number> {
  const { data, width, height } = await greyRaw(png, 700);
  const h = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) h[data[i] as number]!++;
  const t = otsuThreshold(h, data.length);
  const xs: number[] = [];
  const ys: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 60_000));
  for (let i = 0; i < data.length; i += stride) {
    if ((data[i] as number) <= t) { xs.push(i % width); ys.push(Math.floor(i / width)); }
  }
  if (xs.length < 50) return 0;
  const offset = Math.ceil(width * Math.tan((maxDeg * Math.PI) / 180)) + 2;
  const bins = new Float64Array(height + 2 * offset + 2);
  const score = (deg: number): number => {
    bins.fill(0);
    const tn = Math.tan((deg * Math.PI) / 180);
    for (let i = 0; i < xs.length; i++) {
      const b = Math.round((ys[i] as number) - (xs[i] as number) * tn) + offset;
      bins[b] = (bins[b] as number) + 1;
    }
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += (bins[i] as number) * (bins[i] as number);
    return s;
  };
  let bestDeg = 0;
  let bestScore = score(0);
  const base = bestScore;
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) { const s = score(d); if (s > bestScore) { bestScore = s; bestDeg = d; } }
  const centre = bestDeg;
  for (let d = centre - 0.5; d <= centre + 0.5 + 1e-9; d += 0.1) { const s = score(d); if (s > bestScore) { bestScore = s; bestDeg = d; } }
  if (bestScore < base * 1.01) return 0;
  return Math.round(bestDeg * 10) / 10;
}

/** Rotates by `deg` degrees clockwise on a white background (PNG out). */
export async function rotateWhite(png: Uint8Array, deg: number): Promise<Buffer> {
  return sharp(png).rotate(deg, { background: "#ffffff" }).png(fastPng).toBuffer();
}

/** Otsu-binarises to strictly {0,255} (greyscale PNG). */
export async function binarise(png: Uint8Array): Promise<Buffer> {
  const { data } = await sharp(png).greyscale().toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  const h = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) h[data[i] as number]!++;
  const t = otsuThreshold(h, data.length);
  return sharp(png).greyscale().toColourspace("b-w").threshold(t + 1).png(fastPng).toBuffer();
}

/** Trims uniform borders (scanner edge, then margin) and re-adds a small white pad. Returns null if nothing changed. */
export async function cropBorders(png: Uint8Array, padPx: number): Promise<{ data: Buffer; width: number; height: number } | null> {
  const meta = await sharp(png).metadata();
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  let cur: Buffer = Buffer.from(png);
  let curW = w0;
  let curH = h0;
  let changed = false;
  for (let pass = 0; pass < 2; pass++) {
    let out: { data: Buffer; info: OutputInfo };
    try {
      out = await sharp(cur).trim({ threshold: 25 }).png(fastPng).toBuffer({ resolveWithObject: true });
    } catch {
      break; // uniform image: nothing to trim to
    }
    if (out.info.width === curW && out.info.height === curH) break;
    cur = out.data;
    curW = out.info.width;
    curH = out.info.height;
    changed = true;
  }
  if (!changed) return null;
  if (curW * curH < w0 * h0 * 0.05) return null; // over-trim guard (mostly blank page)
  const padded = await sharp(cur).extend({ top: padPx, bottom: padPx, left: padPx, right: padPx, background: "#ffffff" }).png(fastPng).toBuffer({ resolveWithObject: true });
  return { data: padded.data, width: padded.info.width, height: padded.info.height };
}
