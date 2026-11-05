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

/** Inline Markdown to plain text: **b**, __b__, *i*, _i_, `c`, [t](u), ![a](u), \\escapes. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .trim();
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => stripInlineMarkdown(c.trim()));
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
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      const level = Math.min((h[1] ?? "#").length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: stripInlineMarkdown(h[2] ?? "") });
      continue;
    }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line)) { flush(); blocks.push({ kind: "rule" }); continue; }
    if (line.startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1] ?? "")) {
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
