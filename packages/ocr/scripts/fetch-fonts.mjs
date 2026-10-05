#!/usr/bin/env node
/**
 * Fetch Noto fonts (SIL OFL) for every script @civitasone/ocr can put in a searchable-PDF text layer.
 *
 *   node scripts/fetch-fonts.mjs [targetDir]
 *
 * targetDir defaults to $OCR_PDF_FONT_DIR, else <os.tmpdir()>/civitasone-ocr-fonts. Point OCR_PDF_FONT_DIR at the
 * same directory at runtime. Files are named NotoSans<Script>-Regular.ttf so the loader can match the script by
 * file name. Fonts are NOT committed to git. Existing files are skipped; exit code 1 if any download failed.
 *
 * Every download is verified against a PINNED SHA-256 (FONT_SHA256 in ./font-verify.mjs) BEFORE it reaches the final
 * path (the bytes are staged in a private mkdtemp dir, mode 0600, then atomically renamed). A mismatch, or a font
 * without a pinned digest, is refused: nothing is installed and the script exits non-zero. The digests apply to
 * $OCR_FONT_MIRROR too.
 */
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { verifyAndInstall } from "./font-verify.mjs";

const BASE = process.env.OCR_FONT_MIRROR ?? "https://github.com/notofonts/notofonts.github.io/raw/main/fonts";
// [script (must appear in file name), family folder in the mirror, remote file stem]
const FONTS = [
  ["Latin", "NotoSans", "NotoSans"], // Latin; also what a custom Latin font looks like
  ["Devanagari", "NotoSansDevanagari", "NotoSansDevanagari"], // hin, mar
  ["Bengali", "NotoSansBengali", "NotoSansBengali"], // ben, asm
  ["Tamil", "NotoSansTamil", "NotoSansTamil"],
  ["Telugu", "NotoSansTelugu", "NotoSansTelugu"],
  ["Gujarati", "NotoSansGujarati", "NotoSansGujarati"],
  ["Kannada", "NotoSansKannada", "NotoSansKannada"],
  ["Malayalam", "NotoSansMalayalam", "NotoSansMalayalam"],
  ["Gurmukhi", "NotoSansGurmukhi", "NotoSansGurmukhi"], // pan
  ["Odia", "NotoSansOriya", "NotoSansOriya"], // ori
  ["Arabic", "NotoNaskhArabic", "NotoNaskhArabic"], // urd (Naskh; Nastaliq needs a layout engine, see README)
];

const dir = process.argv[2] ?? process.env.OCR_PDF_FONT_DIR ?? join(tmpdir(), "civitasone-ocr-fonts");
await mkdir(dir, { recursive: true, mode: 0o755 });
let failed = 0;
for (const [script, folder, stem] of FONTS) {
  const out = join(dir, script === "Latin" ? "NotoSansLatin-Regular.ttf" : script === "Odia" ? "NotoSansOdia-Regular.ttf" : `${stem}-Regular.ttf`);
  try { if ((await stat(out)).size > 1000) { process.stdout.write(`skip   ${script} (exists)\n`); continue; } } catch { /* fetch */ }
  const url = `${BASE}/${folder}/hinted/ttf/${stem}-Regular.ttf`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const installed = await verifyAndInstall(dir, basename(out), buf);
    process.stdout.write(`fetched ${script} ${(buf.length / 1024).toFixed(0)} KB (sha256 verified) -> ${installed}\n`);
  } catch (e) {
    failed++;
    process.stderr.write(`FAILED ${script} ${url}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
process.stdout.write(`fonts dir: ${dir}\n`);
process.exit(failed > 0 ? 1 : 0);
