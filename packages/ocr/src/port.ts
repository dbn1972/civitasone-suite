/**
 * The OCR port. Every provider (local tesseract or a cloud adapter) implements `OcrProvider`
 * (declared in ./types.ts); this module holds the shared plumbing around it: language
 * validation, bounded concurrency and the injectable clock used by the chain.
 */
import { OCR_LANGS, type OcrLang, type OcrProvider, type PageImage, type PageResult, type RecognizeOptions } from "./types.js";

export type { OcrProvider, PageImage, PageResult, RecognizeOptions } from "./types.js";

/** Time + randomness seam so retry/backoff is deterministic in tests. */
export interface OcrClock {
  random(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: OcrClock = {
  random: () => Math.random(),
  sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
};

export function isOcrLang(value: string): value is OcrLang {
  return (OCR_LANGS as readonly string[]).includes(value);
}

/** Validates and de-duplicates a language list (order preserved: first = primary). */
export function normaliseLangs(langs: readonly string[]): OcrLang[] {
  const out: OcrLang[] = [];
  for (const l of langs) {
    if (!isOcrLang(l)) throw new RangeError(`Unsupported OCR language "${l}" (supported: ${OCR_LANGS.join(",")})`);
    if (!out.includes(l)) out.push(l);
  }
  if (out.length === 0) throw new RangeError("At least one OCR language is required");
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }));
  return results;
}

/** Convenience: recognise one page with any provider. */
export async function recognizePage(provider: OcrProvider, page: PageImage, opts: RecognizeOptions): Promise<PageResult> {
  const [result] = await provider.recognize([page], opts);
  if (!result) throw new Error(`OCR provider "${provider.id}" returned no result for page ${page.pageNumber}`);
  return result;
}
