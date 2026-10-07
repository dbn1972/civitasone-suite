// Server-safe (no "use client"): the chapter page, a server component, calls extractToc.
// These lived in markdown.tsx (a client module), where a server-side import resolves to a
// client reference and calling it threw "TypeError: l is not a function" while prerendering
// /docs/[slug].

/** A single table-of-contents entry derived from a `##`/`###` heading. */
export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Convert heading text to a stable URL fragment id (GAP-DOCS-SLUG-03).
 * Strips inline markdown markers, lowercases, and keeps a-z0-9 plus hyphens so
 * that `#heading` links resolve to the rendered heading's id.
 */
export function slugifyHeading(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract an in-page table of contents from markdown content: every `##` and
 * `###` heading, with the same ids the renderer assigns. Used by the chapter
 * page to render a navigable ToC (GAP-DOCS-SLUG-03).
 */
export function extractToc(content: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    let level: 2 | 3 | null = null;
    let text = "";
    if (line.startsWith("## ")) {
      level = 2;
      text = line.slice(3);
    } else if (line.startsWith("### ")) {
      level = 3;
      text = line.slice(4);
    }
    if (level === null) continue;
    let id = slugifyHeading(text);
    if (!id) continue;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    entries.push({ id, text: text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1"), level });
  }
  return entries;
}
