// UX-004 extraction tooling: finds hardcoded, user-facing English string
// literals in JSX so progress translating the ~3,484-string backlog
// (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md) can be tracked without another
// full manual audit. Deliberately a heuristic, not a full AST/TS-compiler
// pass — false positives/negatives are expected and the CLI's `--dir` flag
// lets a follow-up gap scope a rescan to one hub at a time.
//
// Two shapes are flagged, scanned across the whole file (not line-by-line,
// so a JSX text node that prettier has wrapped onto its own line — the
// common case — is still caught):
//   1. JSX text nodes:            >Some visible text<
//   2. Common user-facing props:  title="..." / label="..." / placeholder="..." / ...

export const TRACKED_PROPS = [
  "title",
  "label",
  "placeholder",
  "alt",
  "aria-label",
  "helperText",
  "description",
  "subtitle",
  "message",
  "buttonText",
  "header",
  "heading",
  "tooltip",
  "emptyTitle",
  "emptyMessage",
];

// Prop names that legitimately carry non-user-facing strings even though a
// naive scan of every `foo="literal"` would otherwise flag them.
const IGNORED_PROP_NAMES = new Set([
  "className",
  "style",
  "href",
  "src",
  "id",
  "key",
  "type",
  "name",
  "rel",
  "target",
  "method",
  "action",
  "role",
  "htmlFor",
  "aria-hidden",
  "aria-labelledby",
  "aria-describedby",
  "data-testid",
]);

const NON_USER_FACING = [
  /^\s*$/, // blank / whitespace-only
  /^[\d\s.,:%$₹+-]+$/, // pure numbers/punctuation
  /^[A-Z0-9_]+$/, // SCREAMING_SNAKE_CASE constants/enum values
  /^https?:\/\//i, // URLs
  /^\//, // paths ("/finance", "/icons/x.svg")
  /\.(svg|png|jpe?g|gif|webp|css|json|ya?ml|csv|pdf)(\?|#|$)/i, // asset/file paths
  /^[a-z0-9-]+$/, // kebab-case tokens (likely a CSS class / slug, not prose)
  /^\$\{/, // starts with a template-literal expression
];

function looksUserFacing(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return !NON_USER_FACING.some((re) => re.test(trimmed));
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Scan one file's source for hardcoded, user-facing string literals.
 * @param {string} filePath - used only for reporting.
 * @param {string} source - file contents.
 * @returns {Array<{file: string, line: number, kind: 'jsx-text'|'prop', prop?: string, text: string}>}
 */
export function scanSource(filePath, source) {
  const findings = [];

  // 1. JSX text nodes: text sitting directly between `>` and `<`, which may
  //    itself span multiple lines once prettier has wrapped it.
  const textNodeRe = />([^<>{}]+)</g;
  let m;
  while ((m = textNodeRe.exec(source))) {
    const text = m[1];
    if (looksUserFacing(text)) {
      // The captured text starts right after the `>`.
      const textStart = m.index + 1;
      findings.push({ file: filePath, line: lineAt(source, textStart), kind: "jsx-text", text: text.trim() });
    }
  }

  // 2. Tracked prop literals: title="..." / label='...' etc.
  //    (excludes t("...")-wrapped values because those aren't `prop="literal"`.)
  const propRe = /\b([a-zA-Z-]+)\s*=\s*(["'])((?:(?!\2)[\s\S])*)\2/g;
  while ((m = propRe.exec(source))) {
    const [, propName, , text] = m;
    if (IGNORED_PROP_NAMES.has(propName)) continue;
    if (!TRACKED_PROPS.includes(propName)) continue;
    if (looksUserFacing(text)) {
      findings.push({ file: filePath, line: lineAt(source, m.index), kind: "prop", prop: propName, text: text.trim() });
    }
  }

  return findings;
}
