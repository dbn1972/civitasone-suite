/**
 * Page orientation detection via tesseract OSD (`osd.traineddata`, legacy engine) - loaded lazily on
 * first use from the same OCR_TESSDATA_PATH/CDN source as the recognition data. If the data cannot be
 * loaded the detector disables itself for the life of the process (returns null) instead of failing
 * the document. `degrees` is the CLOCKWISE rotation that makes the page upright (verified on the host
 * against sharp-rotated test pages: image rotated 90 cw => 270, 270 cw => 90).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface OrientationResult { degrees: 0 | 90 | 180 | 270; confidence: number; script: string | null }

export interface OrientationDetector {
  detect(png: Uint8Array): Promise<OrientationResult | null>;
  dispose(): Promise<void>;
}

interface OsdWorkerLike {
  detect(image: Uint8Array): Promise<{ data: { orientation_degrees: number | null; orientation_confidence: number | null; script: string | null } }>;
  terminate(): Promise<unknown>;
}
export type OsdWorkerFactory = (opts: { langPath?: string; cachePath: string }) => Promise<OsdWorkerLike>;

const defaultOsdFactory: OsdWorkerFactory = async (opts) => {
  const mod = (await import("tesseract.js")) as unknown as {
    createWorker?: (l: string, oem: number, o: Record<string, unknown>) => Promise<OsdWorkerLike>;
    default?: { createWorker: (l: string, oem: number, o: Record<string, unknown>) => Promise<OsdWorkerLike> };
  };
  const create = mod.createWorker ?? mod.default?.createWorker;
  if (!create) throw new Error("tesseract.js createWorker not found");
  const o: Record<string, unknown> = { cachePath: opts.cachePath, legacyCore: true, legacyLang: true };
  if (opts.langPath) o.langPath = opts.langPath;
  return create("osd", 0, o);
};

export class TesseractOsdDetector implements OrientationDetector {
  private worker: Promise<OsdWorkerLike | null> | null = null;
  private readonly langPath: string | undefined;
  private readonly cachePath: string;
  private readonly factory: OsdWorkerFactory;

  constructor(cfg: { tessdataPath?: string; cacheDir?: string; workerFactory?: OsdWorkerFactory; env?: Record<string, string | undefined> } = {}) {
    const env = cfg.env ?? process.env;
    this.langPath = cfg.tessdataPath ?? env.OCR_TESSDATA_PATH ?? undefined;
    this.cachePath = cfg.cacheDir ?? env.OCR_TESSDATA_CACHE ?? join(tmpdir(), "civitasone-ocr-tessdata");
    this.factory = cfg.workerFactory ?? defaultOsdFactory;
  }

  private getWorker(): Promise<OsdWorkerLike | null> {
    this.worker ??= this.factory({ ...(this.langPath ? { langPath: this.langPath } : {}), cachePath: this.cachePath }).catch(() => null);
    return this.worker;
  }

  async detect(png: Uint8Array): Promise<OrientationResult | null> {
    const w = await this.getWorker();
    if (!w) return null;
    try {
      const { data } = await w.detect(png);
      const d = data.orientation_degrees;
      if (d === null || ![0, 90, 180, 270].includes(d)) return null;
      return { degrees: d as 0 | 90 | 180 | 270, confidence: data.orientation_confidence ?? 0, script: data.script };
    } catch {
      return null; // too little text for OSD
    }
  }

  async dispose(): Promise<void> {
    const w = this.worker ? await this.worker : null;
    this.worker = null;
    if (w) await w.terminate().catch(() => undefined);
  }
}
