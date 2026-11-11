/**
 * The one typeface every issued document embeds: Noto Sans Devanagari (SIL Open Font Licence 1.1),
 * self-hosted from the pinned npm package @fontsource/noto-sans-devanagari. It covers Latin and
 * Devanagari plus the rupee sign, so an English, Hindi or bilingual document renders the same on
 * any machine (nothing depends on the viewer having Mangal / Nirmala UI installed).
 *
 * Fontsource splits the family by Unicode subset; a document embeds the "latin" and "devanagari"
 * subsets (regular and bold) and the layout picks the subset per character run.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const req = createRequire(import.meta.url);

export const DOC_FONT = {
  family: "Noto Sans Devanagari",
  npmPackage: "@fontsource/noto-sans-devanagari",
  version: "5.3.0",
  licence: "OFL-1.1",
} as const;

export type DocFontSubset = "latin" | "devanagari";
export type DocFontWeight = 400 | 700;

let packageDir: string | null = null;
function fontPackageDir(): string {
  if (!packageDir) packageDir = dirname(req.resolve(`${DOC_FONT.npmPackage}/LICENSE`));
  return packageDir;
}

const byteCache = new Map<string, Uint8Array>();

/** WOFF bytes of one subset/weight of the document font (read once per process). */
export function docFontBytes(subset: DocFontSubset, weight: DocFontWeight): Uint8Array {
  const key = `${subset}-${weight}`;
  let bytes = byteCache.get(key);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(join(fontPackageDir(), "files", `noto-sans-devanagari-${subset}-${weight}-normal.woff`)));
    byteCache.set(key, bytes);
  }
  return bytes;
}

/** The unicode-range Fontsource declares for a subset (read from its own CSS, so it never drifts). */
export function docFontUnicodeRange(subset: DocFontSubset, weight: DocFontWeight): string | null {
  const css = readFileSync(join(fontPackageDir(), `${weight}.css`), "utf8");
  const block = new RegExp(`noto-sans-devanagari-${subset}-${weight}-normal[\\s\\S]*?unicode-range:\\s*([^;]+);`).exec(css);
  return block?.[1]?.trim() ?? null;
}

let faceCss: string | null = null;

/**
 * @font-face rules with the font inlined as data: URIs, for HTML documents rendered to PDF by
 * Chromium (Form 16). Chromium embeds the glyphs it uses, so the PDF carries the font.
 */
export function docFontFaceCss(): string {
  if (faceCss) return faceCss;
  const rules: string[] = [];
  for (const weight of [400, 700] as const) {
    for (const subset of ["latin", "devanagari"] as const) {
      const range = docFontUnicodeRange(subset, weight);
      const b64 = Buffer.from(docFontBytes(subset, weight)).toString("base64");
      rules.push(
        `@font-face{font-family:"${DOC_FONT.family}";font-style:normal;font-weight:${weight};font-display:block;` +
        `src:url(data:font/woff;base64,${b64}) format("woff");${range ? `unicode-range:${range};` : ""}}`,
      );
    }
  }
  faceCss = rules.join("\n");
  return faceCss;
}

/** CSS font stack for HTML documents: the embedded face first, generic sans as a last resort only. */
export const DOC_FONT_STACK = `"${DOC_FONT.family}", sans-serif`;
