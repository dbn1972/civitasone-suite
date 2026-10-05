import type { BBox, OcrBlock, OcrLine, OcrWord, PageResult, PiiFinding, PiiPolicy } from "../types.js";
import { detectPii, maskText } from "../post/pii.js";

const isMasking = (f: PiiFinding): boolean => f.action === "mask" || f.action === "redact";

function centerIn(b: BBox, box: BBox, pad: number): boolean {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return cx >= box.x0 - pad && cx <= box.x1 + pad && cy >= box.y0 - pad && cy <= box.y1 + pad;
}

function policyFrom(findings: readonly PiiFinding[]): PiiPolicy {
  const p: PiiPolicy = { aadhaar: "flag", pan: "flag", bank_account: "flag", phone: "flag", email: "flag" };
  for (const f of findings) if (isMasking(f)) p[f.type] = f.action;
  return p;
}

/**
 * Returns a copy of the page with every mask/redact finding applied to page text, block/line text and word text.
 * Words are matched by bbox (word centre inside the finding bbox) and become "XXXX"-style tokens (fully masked,
 * no last-4). If any masking finding has no bbox, line text is additionally re-scanned so nothing leaks.
 */
export function maskPageResult(page: PageResult, findings: readonly PiiFinding[]): PageResult {
  const mine = findings.filter((f) => f.pageNumber === page.pageNumber && isMasking(f));
  if (mine.length === 0) return page;
  const boxes = mine.map((f) => f.bbox).filter((b): b is BBox => b !== null);
  const needFallback = mine.some((f) => f.bbox === null);
  const policy = policyFrom(mine);

  const maskWord = (w: OcrWord): OcrWord =>
    boxes.some((b) => centerIn(w.bbox, b, 2)) ? { ...w, text: "X".repeat(Math.max(1, Math.min(w.text.length, 12))) } : w;

  const maskLine = (l: OcrLine): OcrLine => {
    const words = l.words.map(maskWord);
    let text = words.some((w, i) => w !== l.words[i]) ? words.map((w) => w.text).join(" ") : l.text;
    if (needFallback) {
      const fb = detectPii([{ pageNumber: page.pageNumber, text }], undefined, policy);
      text = maskText(text, fb, page.pageNumber);
    }
    return { ...l, text, words };
  };

  const blocks: OcrBlock[] = page.blocks.map((b) => {
    const lines = b.lines.map(maskLine);
    const changed = lines.some((l, i) => l.text !== b.lines[i]?.text);
    return { ...b, lines, text: changed ? lines.map((l) => l.text).join("\n") : b.text };
  });
  return { ...page, text: maskText(page.text, mine, page.pageNumber), blocks };
}

export function maskDocumentPages(pages: readonly PageResult[], findings: readonly PiiFinding[]): PageResult[] {
  return pages.map((p) => maskPageResult(p, findings));
}
