#!/usr/bin/env node
/**
 * route-existence.mjs — static analyzer for GAP-HR-SF-18.
 *
 * Proves that every internal navigation target the web app can construct —
 * statically, not at runtime — actually resolves to a real Next.js route
 * under apps/web/src/app (page.tsx / route.ts, accounting for route groups,
 * parallel-route slots and dynamic segments), or a real static file under
 * apps/web/public. A target that resolves to nothing is a dead link: the
 * user clicks it (or is redirected to it) and gets a 404.
 *
 * This complements two existing, narrower checks already in this repo —
 * it deliberately does not replace or import either, matching this repo's
 * own convention (see hr-role-matrix.mjs's header) of each contract
 * analyzer reading its sources live and standing alone:
 *
 *   - scripts/contract/screen-map.mjs's findDeadLinks() (COMP-005) already
 *     catches a dead literal `href="..."` platform-wide, but ONLY literal
 *     hrefs (a JSX attribute, a `Link` prop, or an object-literal nav
 *     entry) — nothing that requires reading a function body.
 *   - scripts/contract/crm-link-integrity.mjs generalises that to `href`,
 *     `rowLinkPrefix`, and `router.push`/`router.replace`/`redirect`
 *     targets, but only for links starting with `/crm`.
 *
 * This analyzer runs those same link-construction patterns (plus tile-style
 * `path:`/`ctaHref:` data fields, `rowLinkPrefix` in both JSX-attribute and
 * object-literal form across line breaks, and the path literals a row field
 * supplies when `rowLinkPrefix=""`; comments are never scanned)
 * platform-wide (every module, not just CRM), PLUS a fourth pattern neither
 * existing script covers: a helper FUNCTION whose name maps a type/status/
 * key to a URL and returns it (e.g. `buildApprovalLink`, `subjectHref`,
 * `officerApplicationsHref`). These don't have "href" or "rowLinkPrefix" as
 * a token at the CALL site at all — `link: buildApprovalLink(module,
 * refType, refId, taskId)` — so no href-shaped regex over the call site can
 * ever see the actual route string; it has to be found at the function's
 * OWN declaration and checked at its `return` statement instead.
 *
 * Motivating bug (GAP-HR-SF-18 background): apps/web/src/app/_data/
 * loaders.ts's buildApprovalLink() mapped `refType: "finance_bill"` to
 * `/finance/bills/${refId}`, a route that has never existed — the real
 * route is `/finance/expenditure/bills/[id]`. Fixed alongside this analyzer
 * (see the git history for this file's companion commit); this analyzer is
 * what would have caught it, and is what stops the next one from shipping
 * unnoticed.
 *
 * Deliberate scope limits (the same CLASS of limitation the two existing
 * scanners already accept, not new ones — see their own header comments):
 *  - A target that is a variable or an expression, not a string/template
 *    literal, cannot be read statically (e.g. GlobalSearch.tsx's
 *    `buildResultHref` picks its base path out of `MODULE_PATH_MAP` keyed
 *    by a runtime search result's `module` field, which is not an
 *    enumerable static set). It simply never matches the `return [literal]`
 *    extraction below, so it is silently absent from the report — exactly
 *    like a non-literal `router.push(someVariable)` is already silently
 *    absent from crm-link-integrity's report today. This is intentional:
 *    forcing a check that cannot work would either need this analyzer to
 *    execute arbitrary application code, or produce noise no one could act
 *    on. `--report` (see below) still lists which named Link/Href/Path
 *    helper functions were found and whether any literal was extractable
 *    from each, so a genuinely unresolvable one is visible, not silent.
 *  - A `${...}` interpolation inside a literal (in ANY segment) is treated
 *    as an unconditional wildcard — it can match a static OR a dynamic
 *    route segment, because its runtime value can't be known statically.
 *    This can only produce a false OK, never a false DEAD; tightening it
 *    would need runtime data this analyzer doesn't have (same tradeoff
 *    screen-map.mjs's hrefToSegments and crm-link-integrity's
 *    normaliseTemplate already made).
 *
 * Usage:
 *   node scripts/contract/route-existence.mjs            # writes the JSON artefact
 *   node scripts/contract/route-existence.mjs --report    # + human-readable summary
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WEB_APP_DIR = join(ROOT, "apps/web/src/app");
const WEB_SRC_DIR = join(ROOT, "apps/web/src");
const PUBLIC_DIR = join(ROOT, "apps/web/public");
const OUT = join(__dirname, "route-existence.json");

// ── Generic source-text helpers ─────────────────────────────────────────────
// Comment-stripping mirrors hr-role-matrix.mjs's stripComments exactly (same
// technique used throughout this repo's own analyzer scripts): strings and
// template literals are left intact (including their quotes), only comment
// TEXT is removed, and every newline is preserved so line numbers computed
// against the stripped text still match the original file.

function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** String-aware brace matcher: returns the index just past the matching `}` for the `{` at openIdx. */
function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function listFiles(dir, out, opts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    if (entry.name.startsWith("_") && opts.skipPrivate) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, out, opts);
    } else if (opts.filePattern.test(entry.name) && !opts.excludePattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Next.js route inventory (apps/web/src/app + public assets) ──────────
//
// Route groups `(marketing)` and parallel-route slots `@modal` are
// transparent — the URL skips straight past them (mirrors screen-map.mjs's
// collectRouteTemplates exactly, which already covers the whole app tree
// correctly today). `_private` folders never contain a page.tsx in this
// repo, but are skipped explicitly anyway — Next.js itself excludes them
// from routing, so a literal `_private/page.tsx` (if one ever appeared)
// must never be treated as a real route.

function collectRouteTemplates() {
  const templates = [];

  function walk(dir, segmentsSoFar) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith("_")) continue; // Next.js private folder: never routable
        const isGroup = /^\(.*\)$/.test(entry.name);
        const isSlot = entry.name.startsWith("@");
        const nextSegments = (isGroup || isSlot) ? segmentsSoFar : [...segmentsSoFar, entry.name];
        walk(fullPath, nextSegments);
      } else if (/^page\.(tsx|jsx|ts|js)$/.test(entry.name) || /^route\.(ts|js)$/.test(entry.name)) {
        templates.push(segmentsSoFar);
      }
    }
  }

  walk(WEB_APP_DIR, []);
  walkPublicAssets(templates);
  return templates;
}

// Static files under apps/web/public/ are served verbatim at their path and
// are just as real a navigation target as a page.tsx (a spec download, a
// generated PDF) — must not be flagged as dead.
function walkPublicAssets(templates) {
  function walk(dir, segmentsSoFar) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath, [...segmentsSoFar, entry.name]);
      else templates.push([...segmentsSoFar, entry.name]);
    }
  }
  walk(PUBLIC_DIR, []);
}

function routeSegmentType(seg) {
  if (/^\[\.\.\.[^\]]+\]$/.test(seg) || /^\[\[\.\.\.[^\]]+\]\]$/.test(seg)) return "multi"; // [...slug], [[...slug]]
  if (/^\[[^\]]+\]$/.test(seg)) return "single"; // [id]
  return "static";
}

/** A `${...}` interpolation (in any segment) becomes an unconditional wildcard marker — see header comment. */
function toSegments(pathname) {
  const withSentinel = pathname.replace(/\$\{[^}]*\}/g, "__PARAM__");
  return withSentinel.split("/").filter(Boolean).map((seg) => ({
    value: seg,
    isParam: seg.includes("__PARAM__"),
  }));
}

function segsMatchRoute(routeSegs, targetSegs) {
  let ri = 0, ti = 0;
  while (ri < routeSegs.length) {
    const type = routeSegmentType(routeSegs[ri]);
    if (type === "multi") return true; // catch-all is always terminal; consumes the rest
    if (ti >= targetSegs.length) return false;
    if (type === "single") { ri++; ti++; continue; } // route is dynamic here: any concrete or interpolated value matches
    // type === "static": the route requires this exact literal segment. A
    // target segment that is itself an interpolation (isParam) is compared
    // as its literal sentinel text here, NOT treated as an automatic match --
    // deliberately stricter than screen-map.mjs's hrefToSegments/
    // routeMatchesHref, which treats a param on EITHER side as "can't
    // disprove" and auto-matches. That looser rule silently resolves e.g.
    // `/stock/${rowId}` against the unrelated static sibling route
    // `/stock/list` (same segment count, second segment auto-matched) even
    // when no `/stock/[id]` route exists at all -- exactly the class of
    // dead rowLinkPrefix bug this analyzer exists to catch. This instead
    // matches crm-link-integrity.mjs's own (stricter, and correct) regex-
    // based matcher, which only lets its `__param__` sentinel through a
    // route position that is ITSELF a dynamic `[^/]+` segment, never a
    // fixed literal one.
    if (targetSegs[ti].value !== routeSegs[ri]) return false;
    ri++; ti++;
  }
  return ti === targetSegs.length;
}

// ── 2. Candidate-link extraction ────────────────────────────────────────────
//
// Four independent extraction patterns. Each produces a candidate with a raw
// target string; candidates are filtered and resolved uniformly afterwards.

function isRoutePath(raw) {
  if (typeof raw !== "string") return false;
  if (!raw.startsWith("/") || raw.startsWith("//")) return false; // relative/hash/mailto/tel/external
  if (raw.startsWith("/api/")) return false; // gateway call, not a page navigation
  return true;
}

function stripQueryAndHash(raw) {
  return raw.split("#")[0].split("?")[0];
}

const SOURCE_EXCLUDE = /\.(test|spec|stories)\.(tsx|ts|jsx|js)$/;

function isExcludedFile(relPath) {
  // figma-designs/** is an imported design-reference tree, not routable app
  // code (mirrors crm-link-integrity.mjs's own exclusion) — its paths are
  // never rendered by the App Router.
  return relPath.includes("/figma-designs/");
}

const LINK_PATTERNS = [
  // href="/hr/..." | href={"/hr/..."} | href={`/hr/${id}`} | object-literal `href: "/hr/..."` nav entries
  { re: /\bhref\s*[:=]\s*\{?\s*["'`](\/[^"'`]*)["'`]/g, kind: "href" },
  // router.push("/hr/...") / router.replace("/hr/...") / redirect("/hr/...")
  { re: /\b(?:router\.push|router\.replace|redirect)\(\s*["'`](\/[^"'`]*)["'`]/g, kind: "navigate" },
  // Tile / card / nav-entry data objects whose link property is not named `href`:
  // `{ title: "Foo", path: "/x/y" }`, `ctaHref: "/x"`, `detailUrl: `/x/${id}``, `link:`, `route:`, `to:`.
  // Property names are an explicit list (ending in Href/Path/Url/Link/Route, or exactly
  // path/link/route/to/url/target) so unrelated string fields are never read as links.
  { re: /(?<![.\w])(?:[a-z][A-Za-z0-9]*(?:Href|Path|Url|Link|Route)|path|link|route|to|url|target|redirectTo)\s*:\s*["'`](\/[^"'`]*)["'`]/g, kind: "linkField" },
];

// <DataTable rowLinkKey="id" rowLinkPrefix="/hr/employees/" /> -- DataTable.tsx's
// resolveHref appends `${row[rowLinkKey]}` directly to this prefix. Matched in
// JSX-attribute form (`rowLinkPrefix="..."`, `rowLinkPrefix={`...`}`) AND in
// object-literal form (`{ rowLinkKey: "id", rowLinkPrefix: "/x/" }`, used when
// the link is spread conditionally), across line breaks. The type declaration
// `rowLinkPrefix?: string` and a pass-through `rowLinkPrefix={rowLinkPrefix}`
// are not literals and never match; they are checked at the CALL site that
// finally supplies the literal.
const ROW_LINK_PREFIX_RE = /\browLinkPrefix\s*[=:]\s*\{?\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * Blank out `//` and block comments line by line (line numbers preserved).
 * Deliberately conservative vs stripComments(): a stray apostrophe in JSX text
 * can only leave a comment UNstripped (a possible false DEAD that is visible
 * and fixable), never swallow real code (a false OK).
 */
function blankComments(src) {
  let inBlock = false;
  return src
    .split("\n")
    .map((line) => {
      let out = "";
      let i = 0;
      let q = null;
      while (i < line.length) {
        if (inBlock) {
          const e = line.indexOf("*/", i);
          if (e === -1) return out;
          inBlock = false;
          i = e + 2;
          continue;
        }
        const c = line[i];
        if (q) {
          out += c;
          if (c === "\\") { out += line[i + 1] ?? ""; i += 2; continue; }
          if (c === q) q = null;
          i++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
        if (c === "/" && line[i + 1] === "/" && (i === 0 || line[i - 1] !== ":")) return out;
        if (c === "/" && line[i + 1] === "*") { inBlock = true; i += 2; continue; }
        out += c;
        i++;
      }
      return out;
    })
    .join("\n");
}

/**
 * Resolve the full-path target a rowLinkPrefix produces for a row, or null when
 * the prefix is "" (the row key itself holds a full path -- not statically
 * knowable). A prefix with a query/hash (`/hr/payroll/ddos?edit=`) targets that
 * path itself; a prefix ending in "/" gets an `[id]` segment appended.
 */
function resolveRowLinkPrefix(raw) {
  if (raw === "") return null;
  if (/[?#]/.test(raw)) return stripQueryAndHash(raw);
  return raw.endsWith("/") ? `${raw.replace(/\/$/, "")}/\${rowId}` : `${raw}\${rowId}`;
}

function collectLiteralLinks() {
  const links = [];
  const unresolved = [];
  for (const file of listFiles(WEB_SRC_DIR, [], { filePattern: /\.(tsx|ts|jsx|js)$/, excludePattern: SOURCE_EXCLUDE, skipPrivate: false })) {
    const rel = relative(ROOT, file);
    if (isExcludedFile(rel)) continue;
    const text = blankComments(readFileSync(file, "utf8"));
    text.split("\n").forEach((line, i) => {
      for (const { re, kind } of LINK_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const raw = m[1];
          if (!isRoutePath(raw)) continue;
          // `url: `/${path}`` / `url: `/api${x}`` are request builders, not page links.
          if (kind === "linkField" && (/^\/\$\{/.test(raw) || raw.startsWith("/api"))) continue;
          links.push({ file: rel, line: i + 1, kind, target: raw, resolved: stripQueryAndHash(raw) });
        }
      }
    });
    ROW_LINK_PREFIX_RE.lastIndex = 0;
    let rm;
    while ((rm = ROW_LINK_PREFIX_RE.exec(text)) !== null) {
      const raw = rm[2];
      const line = lineAt(text, rm.index);
      const resolved = resolveRowLinkPrefix(raw);
      if (resolved === null) {
        // rowLinkPrefix="" means the row's key field holds the full href. Find
        // that key on the same element and check every path literal the same
        // file assigns to a field of that name (`editHref: `/x/${id}/edit``).
        const keys = [...text.slice(Math.max(0, rm.index - 400), rm.index + 400).matchAll(/\browLinkKey\s*=\s*["'`](\w+)["'`]/g)];
        const key = keys.length ? keys[keys.length - 1][1] : null;
        let found = 0;
        if (key) {
          const fieldRe = new RegExp(`\\b${key}\\s*:\\s*[^"'\`;{}]*?(["'\`])(\\/(?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "g");
          let fm;
          while ((fm = fieldRe.exec(text)) !== null) {
            if (!isRoutePath(fm[2])) continue;
            found++;
            links.push({ file: rel, line: lineAt(text, fm.index), kind: "rowLinkKeyField", target: fm[2], resolved: stripQueryAndHash(fm[2]) });
          }
        }
        if (!found) unresolved.push({ file: rel, line, kind: "rowLinkPrefix", target: raw, reason: key ? `empty prefix: no path literal assigned to \`${key}\` in this file` : "empty prefix: row key not found" });
        continue;
      }
      if (!isRoutePath(raw)) continue;
      links.push({ file: rel, line, kind: "rowLinkPrefix", target: raw, resolved });
    }
  }
  return { links, unresolved };
}

// A helper function whose NAME suggests it maps something to a URL and
// returns it — e.g. buildApprovalLink, subjectHref, officerApplicationsHref,
// empPageHref, recordHref, publicSubmitPath. Grounded against every such
// function actually found in this repo at the time this analyzer was
// written (see the GAP-HR-SF-18 PR description for the full list) — a
// lowercase-initial name (so a PascalCase React component like
// `ProfileLink`/`PrintDocumentLink` is never mistaken for one) ending in
// Link, Href or Path. Only its `return` statement(s) are read; an
// intermediate `const x = ...` assignment is deliberately NOT scanned (see
// header comment: GlobalSearch.tsx's buildResultHref would otherwise
// contribute its unresolvable-by-design `${result.module}` fallback for
// zero real signal).
const HELPER_NAME_RE = /\b(?:export\s+)?function\s+([a-z][A-Za-z0-9_]*(?:Link|Href|Path))\s*\(/g;
const ARROW_HELPER_RE = /\b(?:export\s+)?const\s+([a-z][A-Za-z0-9_]*(?:Link|Href|Path))\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g;
const RETURN_LITERAL_RE = /\breturn\s*[`"']([^`"']*)[`"']/g;
const ARROW_EXPR_LITERAL_RE = /=>\s*[`"']([^`"']*)[`"']/;

function collectHelperReturnLinks() {
  const links = [];
  for (const file of listFiles(WEB_SRC_DIR, [], { filePattern: /\.(tsx|ts)$/, excludePattern: SOURCE_EXCLUDE, skipPrivate: false })) {
    const rel = relative(ROOT, file);
    if (isExcludedFile(rel)) continue;
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);

    HELPER_NAME_RE.lastIndex = 0;
    let hm;
    while ((hm = HELPER_NAME_RE.exec(stripped)) !== null) {
      const name = hm[1];
      const openParenIdx = stripped.indexOf("(", hm.index);
      const openBraceIdx = stripped.indexOf("{", openParenIdx);
      if (openBraceIdx === -1) continue;
      const bodyEnd = findMatchingBrace(stripped, openBraceIdx);
      if (bodyEnd === -1) continue;
      const body = stripped.slice(openBraceIdx, bodyEnd);
      const bodyStartLine = lineAt(stripped, openBraceIdx);

      RETURN_LITERAL_RE.lastIndex = 0;
      let rm;
      while ((rm = RETURN_LITERAL_RE.exec(body)) !== null) {
        const target = rm[1];
        if (!isRoutePath(target)) continue;
        links.push({
          file: rel,
          line: bodyStartLine + lineAt(body, rm.index) - 1,
          kind: "helperReturn",
          fn: name,
          target,
          resolved: stripQueryAndHash(target),
        });
      }
    }

    // Defensive: an expression-bodied arrow (`const fooHref = (id) => \`/foo/${id}\`;`),
    // no concrete instance of this shape exists in the repo today (every
    // Link/Href/Path helper found is a block-bodied `function`), but a
    // future one written this way must not silently go unchecked.
    ARROW_HELPER_RE.lastIndex = 0;
    let am;
    while ((am = ARROW_HELPER_RE.exec(stripped)) !== null) {
      const name = am[1];
      const afterArrowIdx = stripped.indexOf(")", am.index);
      const tail = stripped.slice(afterArrowIdx, afterArrowIdx + 400);
      if (/=>\s*\{/.test(tail.slice(0, 20))) continue; // block-bodied: not this shape
      const em = ARROW_EXPR_LITERAL_RE.exec(tail);
      if (!em) continue;
      const target = em[1];
      if (!isRoutePath(target)) continue;
      links.push({
        file: rel,
        line: lineAt(stripped, am.index),
        kind: "helperReturn",
        fn: name,
        target,
        resolved: stripQueryAndHash(target),
      });
    }
  }
  return links;
}

// ── 3. Analysis ──────────────────────────────────────────────────────────────

function analyse() {
  const routeTemplates = collectRouteTemplates();

  const { links: literalLinks, unresolved: unresolvedRowLinks } = collectLiteralLinks();
  const helperLinks = collectHelperReturnLinks();
  const allLinks = [...literalLinks, ...helperLinks].map((link) => {
    const targetSegs = toSegments(link.resolved);
    const resolved = routeTemplates.some((rt) => segsMatchRoute(rt, targetSegs));
    return { ...link, resolved: link.resolved, ok: resolved };
  });
  allLinks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const byKind = {};
  for (const l of allLinks) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;

  const dead = allLinks.filter((l) => !l.ok);

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    counts: {
      realRoutes: routeTemplates.length,
      totalLinks: allLinks.length,
      byKind,
      dead: dead.length,
      unresolvedRowLinks: unresolvedRowLinks.length,
    },
    links: allLinks,
    dead,
    unresolvedRowLinks,
  };
}

const result = analyse();
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

if (process.argv.includes("--report")) {
  const c = result.counts;
  console.log(`Real routes discovered      : ${c.realRoutes}`);
  console.log(`Link candidates checked     : ${c.totalLinks}  (by kind: ${JSON.stringify(c.byKind)})`);
  console.log(`Dead links                  : ${c.dead}`);
  console.log(`Unresolvable rowLinkPrefix=\"\"  : ${c.unresolvedRowLinks}  (row key holds a full path; not statically checkable)`);
  for (const d of result.dead) {
    console.log(`  [DEAD] ${d.file}:${d.line} (${d.kind}${d.fn ? " " + d.fn : ""}) ${d.target} -> ${d.resolved}`);
  }
}

console.log(`route-existence: wrote ${relative(ROOT, OUT)}`);

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // Imported (e.g. by the contract test for its pure-function unit tests) —
  // analysis above already ran and wrote the artefact once at import time,
  // matching screen-map.mjs's own convention.
}

export { blankComments, resolveRowLinkPrefix, routeSegmentType, toSegments, segsMatchRoute, isRoutePath, collectRouteTemplates };
