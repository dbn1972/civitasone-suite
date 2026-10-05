/**
 * Test-fixture generators: render KNOWN text to PNG / multi-page TIFF / PDF so OCR output can be compared
 * against ground truth. Fixtures are generated at test time into os.tmpdir() (prefix bulk-scan-01-) and never
 * committed. Rendering uses sharp's Pango text input with a font FILE (Indic shaping works via HarfBuzz).
 *
 * Font lookup order per language: env OCR_FIXTURE_FONT_DIR, <tmpdir>/bulk-scan-01-fonts, system font dirs.
 * If still missing and OCR_FIXTURE_FONT_DOWNLOAD=1, a single Noto Sans <Script> TTF (~70-250 KB) is fetched from
 * the notofonts GitHub mirror into <tmpdir>/bulk-scan-01-fonts. Otherwise the language is reported unavailable.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OcrLang } from "../types.js";

const execFileAsync = promisify(execFile);

export type FixtureLang = Extract<OcrLang, "eng" | "hin" | "mar" | "ben" | "tam" | "tel" | "guj">;

/** Known ground-truth text per language (one string per rendered line). */
export const FIXTURE_TEXT: Record<FixtureLang, string[]> = {
  eng: [
    "Office Order No. 12/2024 dated 15 March 2024",
    "Sanction is hereby accorded for the purchase of stationery",
    "The expenditure shall not exceed Rs. 45,000 only",
    "Employee ID EMP-20431 posted to the Accounts Branch",
  ],
  hin: [
    "कार्यालय आदेश संख्या 12 दिनांक 15 मार्च 2024",
    "सरकारी कार्यालय के लिए लेखन सामग्री की स्वीकृति दी जाती है",
    "यह आदेश तत्काल प्रभाव से लागू होगा",
    "वेतन पर्ची एवं सेवा पुस्तिका की जांच की गई",
  ],
  mar: [
    "शासकीय कार्यालयाचा आदेश क्रमांक १२",
    "या कामासाठी मंजुरी देण्यात येत आहे",
    "हा आदेश तात्काळ लागू होईल",
  ],
  ben: [
    "সরকারি কার্যালয়ের আদেশ নম্বর ১২",
    "এই কাজের জন্য অনুমোদন দেওয়া হলো",
    "এই আদেশ অবিলম্বে কার্যকর হবে",
  ],
  tam: [
    "அரசு அலுவலக உத்தரவு எண் 12",
    "இந்த பணிக்கு அனுமதி வழங்கப்படுகிறது",
    "இந்த உத்தரவு உடனடியாக அமலுக்கு வரும்",
  ],
  tel: [
    "ప్రభుత్వ కార్యాలయ ఆదేశం సంఖ్య 12",
    "ఈ పనికి అనుమతి మంజూరు చేయబడింది",
    "ఈ ఆదేశం తక్షణమే అమల్లోకి వస్తుంది",
  ],
  guj: [
    "સરકારી કચેરીનો આદેશ ક્રમાંક 12",
    "આ કામ માટે મંજૂરી આપવામાં આવે છે",
    "આ આદેશ તાત્કાલિક અમલમાં આવશે",
  ],
};

const FONT_HINTS: Record<FixtureLang, { names: string[]; download: string | null }> = {
  eng: { names: ["notosanslatin", "liberationsans-regular", "dejavusans."], download: null },
  hin: { names: ["notosansdevanagari", "lohit-devanagari", "mukta", "devanagari"], download: "Devanagari" },
  mar: { names: ["notosansdevanagari", "lohit-devanagari", "mukta", "devanagari"], download: "Devanagari" },
  ben: { names: ["notosansbengali", "bengali"], download: "Bengali" },
  tam: { names: ["notosanstamil", "tamil"], download: "Tamil" },
  tel: { names: ["notosanstelugu", "telugu"], download: "Telugu" },
  guj: { names: ["notosansgujarati", "gujarati"], download: "Gujarati" },
};

/**
 * Install downloaded bytes at `<dir>/<name>` atomically: the bytes are written (flag wx, mode 0600) into a private
 * mkdtemp staging directory under os.tmpdir() and moved into place with rename(), so a half-written or
 * attacker-pre-created file is never read and no check-then-write race exists. `dir` is created 0700.
 */
export async function writeFileAtomic(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), "bulk-scan-01-dl-"));
  try {
    const tmp = join(staging, "download.part");
    await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const finalPath = join(dir, name);
    await rename(tmp, finalPath);
    return finalPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** A TrueType/OpenType/TTC file starts with one of these 4-byte signatures (cheap sanity check on a download). */
const looksLikeFont = (b: Uint8Array): boolean => {
  const sig = Buffer.from(b.subarray(0, 4)).toString("latin1");
  return (b.length > 1000 && b.length < 20_000_000) && (sig === "\u0000\u0001\u0000\u0000" || sig === "OTTO" || sig === "true" || sig === "ttcf");
};

export function fontCacheDir(): string {
  return join(tmpdir(), "bulk-scan-01-fonts");
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, depth + 1)));
    else if (/\.(ttf|otf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Find a font file able to render `lang`, or null (never throws). */
export async function findFixtureFont(lang: FixtureLang, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const hint = FONT_HINTS[lang];
  const dirs = [env["OCR_FIXTURE_FONT_DIR"], env["OCR_PDF_FONT_DIR"], fontCacheDir(), "/usr/share/fonts", "/usr/local/share/fonts"].filter(
    (d): d is string => typeof d === "string" && d !== "",
  );
  for (const dir of dirs) {
    const files = await walk(dir);
    for (const name of hint.names) {
      const hit = files.find((f) => f.toLowerCase().replace(/^.*\//, "").includes(name) && !/italic|bold/i.test(f));
      if (hit) return hit;
    }
  }
  if (hint.download && env["OCR_FIXTURE_FONT_DOWNLOAD"] === "1") {
    try {
      const res = await fetch(`https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans${hint.download}/hinted/ttf/NotoSans${hint.download}-Regular.ttf`);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeFont(bytes)) return null;
      return await writeFileAtomic(fontCacheDir(), `NotoSans${hint.download}-Regular.ttf`, bytes);
    } catch {
      return null;
    }
  }
  return null;
}

async function fontFamily(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("fc-scan", ["--format", "%{family}", path]);
    const fam = stdout.split(",")[0]?.trim();
    if (fam) return fam;
  } catch { /* fc-scan unavailable: fall through */ }
  return "Sans";
}

const escapeMarkup = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface SharpFn {
  (input: unknown, opts?: unknown): {
    composite(l: unknown[]): ReturnType<SharpFn>;
    png(): ReturnType<SharpFn>;
    greyscale(): ReturnType<SharpFn>;
    raw(): ReturnType<SharpFn>;
    toBuffer(o?: unknown): Promise<Buffer | { data: Buffer; info: { width: number; height: number } }>;
  };
}
async function sharpFn(): Promise<SharpFn> {
  const name = "sharp";
  const mod = (await import(name)) as { default?: SharpFn } & SharpFn;
  return mod.default ?? mod;
}

export interface RenderedPage { png: Buffer; width: number; height: number; dpi: number }
export interface RenderOptions {
  fontPath: string;
  dpi?: number;
  fontSizePt?: number;
  /** A4 at the given dpi by default. */
  widthPx?: number;
  heightPx?: number;
  marginPx?: number;
}

/** Render lines of text black-on-white on an A4-sized page at `dpi` (default 300). */
export async function renderTextPage(lines: readonly string[], opts: RenderOptions): Promise<RenderedPage> {
  const sharp = await sharpFn();
  const dpi = opts.dpi ?? 300;
  const width = opts.widthPx ?? Math.round((210 / 25.4) * dpi);
  const height = opts.heightPx ?? Math.round((297 / 25.4) * dpi);
  const margin = opts.marginPx ?? Math.round(dpi * 0.75);
  const family = await fontFamily(opts.fontPath);
  const textPng = (await sharp({
    text: {
      text: lines.map(escapeMarkup).join("\n"),
      font: `${family} ${opts.fontSizePt ?? 14}`,
      fontfile: opts.fontPath,
      width: width - 2 * margin,
      dpi,
      spacing: Math.round(dpi * 0.12),
      rgba: true,
    },
  })
    .png()
    .toBuffer()) as Buffer;
  const png = (await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([{ input: textPng, top: margin, left: margin }])
    .png()
    .toBuffer()) as Buffer;
  return { png, width, height, dpi };
}

// ---------------------------------------------------------------- multi-page TIFF (baseline, uncompressed, 8-bit grey)

export interface GreyFrame { width: number; height: number; pixels: Uint8Array; dpi?: number }

export function encodeMultiPageTiff(frames: readonly GreyFrame[]): Uint8Array {
  const ENTRIES = 12;
  const IFD_SIZE = 2 + ENTRIES * 12 + 4;
  let total = 8;
  for (const f of frames) total += IFD_SIZE + 16 + f.pixels.length;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 0x2a, 0x00]);
  dv.setUint32(4, 8, true);
  let pos = 8;
  frames.forEach((f, idx) => {
    const ifd = pos;
    const ratPos = ifd + IFD_SIZE;
    const dataPos = ratPos + 16;
    const dpi = f.dpi ?? 300;
    dv.setUint16(ifd, ENTRIES, true);
    let e = ifd + 2;
    const entry = (tag: number, type: number, count: number, value: number): void => {
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(e + 8, value, true);
      else dv.setUint32(e + 8, value, true);
      e += 12;
    };
    entry(256, 4, 1, f.width);
    entry(257, 4, 1, f.height);
    entry(258, 3, 1, 8);
    entry(259, 3, 1, 1);
    entry(262, 3, 1, 1);
    entry(273, 4, 1, dataPos);
    entry(277, 3, 1, 1);
    entry(278, 4, 1, f.height);
    entry(279, 4, 1, f.pixels.length);
    entry(282, 5, 1, ratPos);
    entry(283, 5, 1, ratPos + 8);
    entry(296, 3, 1, 2);
    pos = dataPos + f.pixels.length;
    dv.setUint32(e, idx === frames.length - 1 ? 0 : pos, true);
    dv.setUint32(ratPos, dpi, true); dv.setUint32(ratPos + 4, 1, true);
    dv.setUint32(ratPos + 8, dpi, true); dv.setUint32(ratPos + 12, 1, true);
    buf.set(f.pixels, dataPos);
  });
  return buf;
}

/** PNG pages -> multi-page grey TIFF bytes. */
export async function pngsToMultiPageTiff(pngs: readonly Buffer[], dpi = 300): Promise<Uint8Array> {
  const sharp = await sharpFn();
  const frames: GreyFrame[] = [];
  for (const png of pngs) {
    const { data, info } = (await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })) as {
      data: Buffer; info: { width: number; height: number };
    };
    frames.push({ width: info.width, height: info.height, pixels: new Uint8Array(data), dpi });
  }
  return encodeMultiPageTiff(frames);
}

// ---------------------------------------------------------------- PDFs

/** Image-only PDF (a "scan"): one PNG per page, page size = pixels at dpi. */
export async function makeImageOnlyPdf(pages: readonly RenderedPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const s = 72 / p.dpi;
    const page = doc.addPage([p.width * s, p.height * s]);
    page.drawImage(await doc.embedPng(p.png), { x: 0, y: 0, width: p.width * s, height: p.height * s });
  }
  return doc.save({ useObjectStreams: false });
}

/** Born-digital PDF with a real, visible Latin text layer (Helvetica). */
export async function makeBornDigitalPdf(lines: readonly string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  for (const l of lines) {
    page.drawText(l, { x: 56, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 24;
  }
  return doc.save({ useObjectStreams: false });
}

export async function makeFixtureDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bulk-scan-01-fixtures-"));
}

export interface LanguageFixture { lang: FixtureLang; lines: string[]; page: RenderedPage; fontPath: string }

/** Render one page for `lang`, or null with a reason when no font is available. */
export async function makeLanguageFixture(lang: FixtureLang, dpi = 300): Promise<LanguageFixture | { lang: FixtureLang; unavailable: string }> {
  const fontPath = await findFixtureFont(lang);
  if (!fontPath) return { lang, unavailable: `no font able to render "${lang}" (set OCR_FIXTURE_FONT_DIR or OCR_FIXTURE_FONT_DOWNLOAD=1)` };
  const lines = FIXTURE_TEXT[lang];
  return { lang, lines, fontPath, page: await renderTextPage(lines, { fontPath, dpi }) };
}

/** Ground-truth text of a fixture (lines joined by newline). */
export const groundTruth = (lang: FixtureLang): string => FIXTURE_TEXT[lang].join("\n");

// ---------------------------------------------------------------- character error rate

export function normaliseForCer(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function levenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[B.length] ?? 0;
}

/** CER = edit distance / reference length, whitespace-normalised, in code points. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const ref = normaliseForCer(reference);
  const hyp = normaliseForCer(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return levenshtein(ref, hyp) / [...ref].length;
}
