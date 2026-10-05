import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../src/fixtures/index.js";

export const TESSDATA_VERSION = "4.0.0_best_int";

export function tessdataDir(env: Record<string, string | undefined> = process.env): string {
  const p = env["OCR_TESSDATA_PATH"];
  return p && !/^https?:/i.test(p) ? p : join(tmpdir(), "bulk-scan-01-tessdata");
}

const exists = async (p: string): Promise<boolean> => access(p).then(() => true, () => false);

/**
 * Ensure `<lang>.traineddata.gz` exists locally. Downloads from the tesseract.js-data CDN ONLY when
 * OCR_TEST_DOWNLOAD=1 (the files are 1-15 MB; they go to os.tmpdir(), never into the repo).
 * Returns null when available, otherwise the precise reason it is not.
 */
export async function ensureTessdata(lang: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const dir = tessdataDir(env);
  const file = join(dir, `${lang}.traineddata.gz`);
  if (await exists(file)) return null;
  if (env["OCR_TEST_DOWNLOAD"] !== "1") return `${lang}.traineddata.gz not found in ${dir} and OCR_TEST_DOWNLOAD!=1`;
  try {
    const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/${TESSDATA_VERSION}/${lang}.traineddata.gz`;
    const res = await fetch(url);
    if (!res.ok) return `download of ${url} failed: HTTP ${res.status}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1000 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return `download of ${url} is not a gzip file`;
    await writeFileAtomic(dir, `${lang}.traineddata.gz`, bytes);
    return null;
  } catch (e) {
    return `download failed (no network?): ${e instanceof Error ? e.message : String(e)}`;
  }
}
