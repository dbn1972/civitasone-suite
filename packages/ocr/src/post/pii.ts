/**
 * PII detection / masking / redaction (DPDP). Findings NEVER carry raw values - only offsets, bbox and a
 * masked preview. `scrubForLog` deep-masks PII-looking strings so raw PII cannot reach logs.
 */
import type { BBox, OcrWord, PiiAction, PiiFinding, PiiPolicy, PiiType } from "../types.js";
import { DEFAULT_PII_POLICY } from "../types.js";
import { previewFor, scanAll, type ScanOptions } from "./patterns.js";
import { locateWords, wordKey, type PageTextInput } from "./wordmap.js";

export interface PiiPageText { pageNumber: number; text: string }
export type WordBoxes = Readonly<Record<number, readonly OcrWord[]>> | ReadonlyMap<number, readonly OcrWord[]>;

export interface DetectPiiOptions {
  /** Drop grouped (4-4-4) Aadhaar-looking numbers that fail Verhoeff. Default false = over-detect (safer for DPDP). */
  strictAadhaar?: boolean;
}

const PII_KINDS = ["aadhaar", "pan", "account_no", "phone", "email"] as const;
const KIND_TO_TYPE: Record<(typeof PII_KINDS)[number], PiiType> = {
  aadhaar: "aadhaar", pan: "pan", account_no: "bank_account", phone: "phone", email: "email",
};

function wordsFor(boxes: WordBoxes | undefined, page: number): readonly OcrWord[] | undefined {
  if (!boxes) return undefined;
  if (boxes instanceof Map) return boxes.get(page);
  return (boxes as Readonly<Record<number, readonly OcrWord[]>>)[page];
}

/** Labelled 16-digit account numbers (VID/card-like) are never left unmasked: flag => mask; mask/redact kept. */
export function effectiveAction(kind: string, value: string, action: PiiAction): PiiAction {
  return kind === "account_no" && value.length === 16 && action === "flag" ? "mask" : action;
}

export function detectPii(
  pageTexts: readonly PiiPageText[],
  wordBoxes: WordBoxes | undefined,
  policy: PiiPolicy = DEFAULT_PII_POLICY,
  opts: DetectPiiOptions = {},
): PiiFinding[] {
  const scanOpts: ScanOptions = { kinds: PII_KINDS, strictAadhaar: opts.strictAadhaar ?? false };
  const findings: PiiFinding[] = [];
  for (const page of pageTexts) {
    const words = wordsFor(wordBoxes, page.pageNumber);
    const occ = new Map<string, number>();
    for (const m of scanAll(page.text, scanOpts)) {
      if (m.kind !== "aadhaar" && m.kind !== "pan" && m.kind !== "account_no" && m.kind !== "phone" && m.kind !== "email") continue;
      const type = KIND_TO_TYPE[m.kind];
      const rawText = page.text.slice(m.start, m.end);
      const key = `${type}:${wordKey(rawText)}`;
      const n = occ.get(key) ?? 0;
      occ.set(key, n + 1);
      const hit = words ? locateWords(words, rawText, n) : null;
      findings.push({
        type, pageNumber: page.pageNumber, start: m.start, end: m.end, bbox: hit?.bbox ?? null,
        // a labelled 16-digit account number is as sensitive as a VID: "flag" is upgraded to "mask" (type stays bank_account)
        action: effectiveAction(m.kind, m.value, policy[type]), maskedPreview: previewFor(m.kind, m.value),
      });
    }
  }
  return findings;
}

/** Convenience over OCR PageResults. */
export function detectPiiInPages(
  pages: readonly { pageNumber: number; text: string; blocks: readonly { lines: readonly { words: readonly OcrWord[] }[] }[] }[],
  policy: PiiPolicy = DEFAULT_PII_POLICY,
  opts: DetectPiiOptions = {},
): PiiFinding[] {
  const boxes = new Map<number, readonly OcrWord[]>();
  for (const p of pages) boxes.set(p.pageNumber, p.blocks.flatMap((b) => b.lines.flatMap((l) => l.words)));
  return detectPii(pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })), boxes, policy, opts);
}

export const REDACTED_TOKEN = "[REDACTED]";

/** Replace mask/redact spans of ONE page's text. Findings for other pages are ignored when pageNumber is given. */
export function maskText(text: string, findings: readonly PiiFinding[], pageNumber?: number): string {
  const applicable = findings
    .filter((f) => (f.action === "mask" || f.action === "redact") && (pageNumber === undefined || f.pageNumber === pageNumber))
    .sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const f of applicable) {
    if (f.end > floor || f.start < 0 || f.end > out.length) continue; // skip overlaps/out-of-range
    out = out.slice(0, f.start) + (f.action === "redact" ? REDACTED_TOKEN : f.maskedPreview) + out.slice(f.end);
    floor = f.start;
  }
  return out;
}

/** Policy used for text leaving the process (AI hooks): every PII type fully redacted, whatever the tenant policy says. */
const REDACT_EVERYTHING: PiiPolicy = { aadhaar: "redact", pan: "redact", bank_account: "redact", phone: "redact", email: "redact" };

/**
 * Page text safe to hand to a third-party / model hook: Aadhaar (+VID), PAN, bank account, phone and email are
 * replaced by "[REDACTED]" (no last-4, no domain) REGARDLESS of the tenant's mask/flag policy, with the most
 * over-detecting settings (non-strict Aadhaar). Pages are joined with "\n".
 */
export function redactPagesForAi(pages: readonly { pageNumber: number; text: string }[]): string {
  const findings = detectPii(pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })), undefined, REDACT_EVERYTHING, { strictAadhaar: false });
  return pages.map((p) => maskText(p.text, findings, p.pageNumber)).join("\n");
}

export function distinctPiiTypes(findings: readonly PiiFinding[]): PiiType[] {
  return [...new Set(findings.map((f) => f.type))].sort();
}

export function needsPiiReview(findings: readonly PiiFinding[], reviewActions: readonly PiiAction[] = ["flag"]): boolean {
  return findings.some((f) => reviewActions.includes(f.action));
}

// ---------------------------------------------------------------- image redaction

interface SharpLike {
  metadata(): Promise<{ width?: number; height?: number }>;
  composite(layers: { input: Buffer; top: number; left: number }[]): SharpLike;
  png(): SharpLike;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Uint8Array | Buffer) => SharpLike;

async function loadSharp(): Promise<SharpFactory> {
  // Lazy, non-literal specifier: `sharp` is a dependency owned by the package skeleton; keeping the import
  // dynamic means pure-text consumers (classify/extract/mask) never load native code.
  const name = "sharp";
  const mod = (await import(name)) as { default?: SharpFactory } & SharpFactory;
  return mod.default ?? mod;
}

export interface RedactImageResult {
  /** PNG bytes with opaque black boxes over every locatable `redact` finding. */
  data: Uint8Array;
  redacted: number;
  /** `redact` findings without a bbox: could NOT be drawn - caller must route the page to review. */
  unlocatable: number;
}

export async function redactImage(
  pageImageBytes: Uint8Array,
  findings: readonly PiiFinding[],
  opts: { pageNumber?: number; padding?: number } = {},
): Promise<RedactImageResult> {
  const sharp = await loadSharp();
  const todo = findings.filter((f) => f.action === "redact" && (opts.pageNumber === undefined || f.pageNumber === opts.pageNumber));
  const boxes: BBox[] = [];
  let unlocatable = 0;
  for (const f of todo) {
    if (f.bbox) boxes.push(f.bbox);
    else unlocatable++;
  }
  const img = sharp(pageImageBytes);
  if (boxes.length === 0) return { data: await img.png().toBuffer(), redacted: 0, unlocatable };
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const pad = opts.padding ?? 2;
  const rects = boxes
    .map((b) => {
      const x = Math.max(0, Math.floor(b.x0 - pad));
      const y = Math.max(0, Math.floor(b.y0 - pad));
      return `<rect x="${x}" y="${y}" width="${Math.ceil(Math.min(w, b.x1 + pad) - x)}" height="${Math.ceil(Math.min(h, b.y1 + pad) - y)}" fill="#000"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`;
  const data = await sharp(pageImageBytes).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  return { data, redacted: boxes.length, unlocatable };
}

// ---------------------------------------------------------------- log scrubbing

// KEEP IDENTICAL to SCRUBBERS in packages/scan-link/src/index.ts (scrubReasonText); a parity test
// (tests/post/scrub-parity.test.ts) runs one corpus through both. Digit groups are masked fully, keeping at MOST
// the last 4 digits.
const SCRUBBERS: readonly [RegExp, (m: string) => string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => "[EMAIL]"],
  [/(?<![A-Za-z0-9])[A-Z]{5}[0-9OIl]{4}[A-Z](?![A-Za-z0-9])/g, (m) => `XXXXXX${m.slice(-4)}`],
  // 16 digits (Aadhaar VID / card), 4-4-4-4 grouped by up to two spaces/hyphens/newlines or contiguous
  [/(?<!\d)\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}(?!\d)/g, (m) => `XXXX XXXX XXXX ${m.replace(/\D/g, "").slice(-4)}`],
  // 12-digit (optionally grouped) -> Aadhaar style; any run of 9+ digits, of any length (accounts, phones with country code) -> last 4
  [/(?<!\d)\d{4}[\s-]{0,2}\d{4}[\s-]{0,2}\d{4}(?!\d)/g, (m) => `XXXX XXXX ${m.replace(/\D/g, "").slice(-4)}`],
  [/(?<!\d)(?:\+?91[ -]?|0[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, (m) => `XXXXXX${m.replace(/\D/g, "").slice(-4)}`],
  [/(?<!\d)\d{9,}(?!\d)/g, (m) => `${"X".repeat(m.length - 4)}${m.slice(-4)}`],
];

/** Mask PII-looking substrings of a string (emails, PAN, Aadhaar-style, phones, runs of 9+ digits). */
export function scrubString(s: string): string {
  let out = s;
  for (const [re, fn] of SCRUBBERS) out = out.replace(re, fn);
  return out;
}

/** Deep copy of `value` with every string scrubbed. Handles arrays, plain objects, Errors, Maps/Sets and cycles. */
export function scrubForLog<T>(value: T): T {
  return scrub(value, new WeakMap()) as T;
}

function scrub(v: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "bigint") return scrubString(v.toString());
  // numbers: a numeric Aadhaar/account/phone logged as a number must not leak; >= 9 digits => scrubbed string
  if (typeof v === "number") return (String(v).match(/\d/g) ?? []).length >= 9 ? scrubString(String(v)) : v;
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Error) {
    const e = { name: v.name, message: scrubString(v.message), stack: v.stack ? scrubString(v.stack) : undefined };
    seen.set(v, e);
    return e;
  }
  if (v instanceof Date) return v;
  if (v instanceof Uint8Array) return `[bytes:${v.byteLength}]`;
  if (Array.isArray(v)) {
    const arr: unknown[] = [];
    seen.set(v, arr);
    for (const x of v) arr.push(scrub(x, seen));
    return arr;
  }
  if (v instanceof Map) {
    const arr: unknown[] = [];
    seen.set(v, arr);
    for (const [k, x] of v) arr.push([scrub(k, seen), scrub(x, seen)]);
    return arr;
  }
  if (v instanceof Set) {
    const arr: unknown[] = [];
    seen.set(v, arr);
    for (const x of v) arr.push(scrub(x, seen));
    return arr;
  }
  const o: Record<string, unknown> = {};
  seen.set(v, o);
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[scrubString(k)] = scrub(x, seen);
  return o;
}

export type { PageTextInput };
