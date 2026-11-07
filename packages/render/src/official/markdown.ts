/**
 * Minimal Markdown to document blocks, for minutes and other officer-authored text that is
 * stored as Markdown. An issued PDF shows the formatted text, never raw "#", "**" or "_".
 * Supported: ATX headings (#..###), paragraphs, "-"/"*"/"+" bullets, "1." numbered items,
 * pipe tables, horizontal rules; inline emphasis, code and links are reduced to plain text.
 */

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "para"; text: string }
  | { kind: "item"; marker: string; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
const isWord = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);

/**
 * indexOf with a memo for the "not found" answer. A scan that moves forward and asks "where is the next X?"
 * from ever-later positions never rescans: once X is known to be absent from some position on, it is absent
 * for every later one. This is what keeps the link / image scanners linear on input such as "![](" repeated.
 */
function forwardFinder(s: string, needle: string): (from: number) => number {
  let absentFrom = Infinity;
  let lastFrom = -1;
  let lastAt = -1; // the first needle at or after lastFrom
  return (from) => {
    if (from >= absentFrom) return -1;
    if (from >= lastFrom && lastAt >= from) return lastAt; // nothing between lastFrom and lastAt, so none after from
    const at = s.indexOf(needle, from);
    if (at < 0) absentFrom = from;
    else { lastFrom = from; lastAt = at; }
    return at;
  };
}

/**
 * ![alt](url) (image=true) or [text](url) (image=false) to the alt / text. Same matches as the regexes
 * /!\[([^\]]*)\]\([^)]*\)/ and /\[([^\]]+)\]\(([^)]*)\)/, found in one linear scan (those regexes are
 * polynomial on "![](" repeated without a closing parenthesis; this input is officer-authored).
 */
function stripLinks(s: string, image: boolean): string {
  const open = image ? "![" : "[";
  const findClose = forwardFinder(s, "]");
  const findParen = forwardFinder(s, ")");
  let out = "";
  let last = 0;
  let i = s.indexOf(open);
  while (i >= 0) {
    const textStart = i + open.length;
    const j = findClose(textStart); // first "]" (the text can not contain one)
    if (j < 0) break; // no "]" anywhere ahead: no further link can match
    if (s[j + 1] === "(" && (image || j > textStart)) {
      const k = findParen(j + 2);
      if (k < 0) break; // no ")" anywhere ahead
      out += s.slice(last, i) + s.slice(textStart, j);
      last = k + 1;
      i = s.indexOf(open, last);
    } else {
      i = s.indexOf(open, i + 1);
    }
  }
  return out + s.slice(last);
}

/** `code` to code: /`([^`]*)`/g. */
function stripCode(s: string): string {
  let out = "";
  let last = 0;
  let i = s.indexOf("`");
  while (i >= 0) {
    const j = s.indexOf("`", i + 1);
    if (j < 0) break;
    out += s.slice(last, i) + s.slice(i + 1, j);
    last = j + 1;
    i = s.indexOf("`", last);
  }
  return out + s.slice(last);
}

/** **b** / __b__ to b: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, scanning each marker's closer at most once. */
function stripStrong(s: string): string {
  let out = "";
  let last = 0;
  const noCloser: Record<string, boolean> = {};
  let i = 0;
  while (i < s.length - 1) {
    const m = s.startsWith("**", i) ? "**" : s.startsWith("__", i) ? "__" : "";
    if (!m || noCloser[m] || i + 2 >= s.length || isSpace(s[i + 2])) { i += 1; continue; }
    let p = i + 2;
    while (p < s.length && (isSpace(s[p]) || !s.startsWith(m, p + 1))) p += 1;
    if (p >= s.length) { noCloser[m] = true; i += 1; continue; }
    out += s.slice(last, i) + s.slice(i + 2, p + 1);
    last = p + 3;
    i = last;
  }
  return out + s.slice(last);
}

/**
 * *i* (ch="*", the char before it may be anything but a word char or "*") and _i_ (ch="_", before it anything but
 * a word char) to i: /(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g and /(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g.
 * The text can not contain ch, so each scan stops at the next ch: the scans never overlap and the pass is linear.
 */
function stripEmphasis(s: string, ch: "*" | "_"): string {
  const beforeOk = (c: string) => !isWord(c) && (ch === "_" || c !== "*");
  let out = "";
  let last = 0; // end of the previous match: the next match (and its before-char) starts at or after it
  for (let i = s.indexOf(ch); i >= 0; i = s.indexOf(ch, i + 1)) {
    if (i < last) continue;
    const atStart = i === 0;
    if (!atStart && (i - 1 < last || !beforeOk(s[i - 1] ?? ""))) continue;
    const a = i + 1;
    if (a >= s.length || isSpace(s[a])) continue;
    let p = a;
    let found = -1;
    while (p < s.length) {
      if (!isSpace(s[p]) && s[p + 1] === ch && !isWord(s[p + 2])) { found = p; break; }
      if (s[p] === ch) break; // the text can not run past another ch
      p += 1;
    }
    if (found < 0) continue;
    out += s.slice(last, i) + s.slice(a, found + 1);
    last = found + 2;
  }
  return out + s.slice(last);
}

/** Inline Markdown to plain text: **b**, __b__, *i*, _i_, `c`, [t](u), ![a](u), \\escapes. Linear time. */
export function stripInlineMarkdown(s: string): string {
  return stripEmphasis(stripEmphasis(stripStrong(stripCode(stripLinks(stripLinks(s, true), false))), "*"), "_")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .trim();
}

/**
 * A table separator row such as "| --- | :-: |": cells of two or more dashes with optional colons, joined by "|"
 * (optional outer pipes), whitespace allowed around every token. Same language as
 * /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/ without its adjacent \s* quantifiers.
 */
function isTableSep(line: string): boolean {
  let i = 0;
  const n = line.length;
  const skip = () => { while (i < n && isSpace(line[i])) i += 1; };
  skip();
  if (line[i] === "|") i += 1;
  for (;;) {
    skip();
    if (line[i] === ":") i += 1;
    let dashes = 0;
    while (line[i] === "-") { dashes += 1; i += 1; }
    if (dashes < 2) return false;
    if (line[i] === ":") i += 1;
    skip();
    if (i >= n) return true;
    if (line[i] !== "|") return false;
    i += 1;
    skip();
    if (i >= n) return true; // trailing pipe
  }
}

function tableCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => stripInlineMarkdown(c.trim()));
}

/** "## Title ##" to { level, text }: 1-6 leading "#", whitespace, the text without trailing whitespace / "#" marks. */
function parseHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  let n = 0;
  while (line[n] === "#") n += 1;
  if (n < 1 || n > 6 || !isSpace(line[n])) return null;
  let start = n;
  while (isSpace(line[start])) start += 1;
  let end = line.length;
  while (end > start && isSpace(line[end - 1])) end -= 1;
  while (end > start && line[end - 1] === "#") end -= 1;
  while (end > start && isSpace(line[end - 1])) end -= 1;
  return { level: Math.min(n, 3) as 1 | 2 | 3, text: line.slice(start, end) };
}

export function parseMarkdown(src: string | null | undefined): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      const text = stripInlineMarkdown(para.join(" "));
      if (text) blocks.push({ kind: "para", text });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = parseHeading(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h.level, text: stripInlineMarkdown(h.text) });
      continue;
    }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line)) { flush(); blocks.push({ kind: "rule" }); continue; }
    if (line.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1] ?? "")) {
      flush();
      const rows: string[][] = [tableCells(line)];
      i += 1;
      while (i + 1 < lines.length && (lines[i + 1] ?? "").trim().startsWith("|")) {
        i += 1;
        rows.push(tableCells(lines[i] ?? ""));
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) { flush(); blocks.push({ kind: "item", marker: "•", text: stripInlineMarkdown(bullet[1] ?? "") }); continue; }
    const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (numbered) { flush(); blocks.push({ kind: "item", marker: `${numbered[1]}.`, text: stripInlineMarkdown(numbered[2] ?? "") }); continue; }
    para.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return blocks;
}
