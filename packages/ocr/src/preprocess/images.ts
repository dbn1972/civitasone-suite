/** Image inputs (PNG/JPEG/multipage TIFF) -> normalised PNG page rasters via sharp. */
import sharp from "sharp";
import { OcrInputError } from "../errors.js";

export interface RasterPage {
  pageNumber: number; png: Buffer; width: number; height: number; dpi: number;
  /** DPI before any maxPixels downscale. */
  requestedDpi: number;
  /** True when the page was resized down to fit maxPixels. */
  downscaled: boolean;
}

export async function imagePageCount(data: Uint8Array): Promise<number> {
  try {
    const meta = await sharp(data).metadata();
    return Math.max(1, meta.pages ?? 1);
  } catch (err) {
    throw new OcrInputError("CORRUPT", `Image could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Decodes page `index` (0-based) to PNG, applying EXIF orientation. When `maxPixels` is given and the page
 * area exceeds it, the page is resized down (aspect preserved, DPI scaled accordingly) before PNG encoding.
 */
export async function readImagePage(data: Uint8Array, index: number, defaultDpi: number, maxPixels?: number): Promise<RasterPage> {
  try {
    const meta = await sharp(data, { page: index }).metadata();
    let pipeline = sharp(data, { page: index }).rotate();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const requestedDpi = meta.density && meta.density >= 50 && meta.density <= 1200 ? Math.round(meta.density) : defaultDpi;
    let factor = 1;
    if (maxPixels !== undefined && w > 0 && h > 0 && w * h > maxPixels) {
      factor = Math.sqrt(maxPixels / (w * h)) * 0.999;
      const swap = (meta.orientation ?? 1) >= 5; // EXIF 5-8 rotate by 90deg: resize() runs after rotate()
      pipeline = pipeline.resize({ width: Math.max(1, Math.floor((swap ? h : w) * factor)) });
    }
    const { data: png, info } = await pipeline.png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true });
    return {
      pageNumber: index + 1, png, width: info.width, height: info.height,
      dpi: Math.max(1, Math.round(requestedDpi * factor)), requestedDpi, downscaled: factor < 1,
    };
  } catch (err) {
    throw new OcrInputError("CORRUPT", `Image page ${index + 1} could not be decoded: ${err instanceof Error ? err.message : String(err)}`);
  }
}
