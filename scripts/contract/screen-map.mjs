#!/usr/bin/env node
/**
 * screen-map.mjs — static contract analyzer
 *
 * For every web screen: proves the chain
 *   screen → loader → gateway → service route → migration table
 *
 * Usage:
 *   node scripts/contract/screen-map.mjs
 *   node scripts/contract/screen-map.mjs --module finance
 *   node scripts/contract/screen-map.mjs --json
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const moduleFilter = args[args.indexOf('--module') + 1] ?? null;
const jsonOnly = args.includes('--json');

// ── Gateway registry parser ───────────────────────────────────────────────────

function parseGatewayRegistry() {
  const registryPath = join(ROOT, 'services/gateway-service/src/registry.ts');
  if (!existsSync(registryPath)) return [];
  const src = readFileSync(registryPath, 'utf8');

  const routes = [];
  // Match each { name: "...", prefix: "...", ..., upstreamPath?: "..." } object
  const blockRe = /\{\s*name:\s*["']([^"']+)["']\s*,\s*prefix:\s*["']([^"']+)["']([^}]*)\}/gs;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const name = m[1];
    const prefix = m[2];
    const rest = m[3];
    const upstreamPathMatch = rest.match(/upstreamPath:\s*["']([^"']+)["']/);
    const upstreamPath = upstreamPathMatch ? upstreamPathMatch[1] : null;
    routes.push({ name, prefix, upstreamPath });
  }
  return routes;
}

const SERVICE_ROUTES = parseGatewayRegistry();

// Sort descending by prefix length (longest match wins, same as gateway)
const SORTED_ROUTES = [...SERVICE_ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);

function resolveGateway(apiPath) {
  // Strip query string
  const pathname = apiPath.split('?')[0];
  for (const route of SORTED_ROUTES) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || '/';
      const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, '');
      return {
        routeName: route.name,
        upstreamPath: `${basePath}${remainder}`,
      };
    }
  }
  return null;
}

// ── Service directory mapping ─────────────────────────────────────────────────

const SERVICE_DIR_MAP = {
  'identity': 'identity-service',
  'policy': 'policy-service',
  'policy-v1': 'policy-service',
  'audit-events': 'audit-service',
  'audit': 'audit-service',
  'notification': 'notification-service',
  'notification-v1': 'notification-service',
  'finance': 'finance-service',
  'procurement': 'procurement-service',
  'contract': 'contract-service',
  'estab': 'estab-service',
  'stock': 'stock-service',
  'hrms': 'hrms-service',
  'payroll': 'payroll-service',
  'project': 'project-service',
  'projects': 'project-service',
  'asset': 'asset-service',
  'grant': 'grant-service',
  'citizen': 'citizen-service',
  'legal': 'legal-service',
  'admin': 'admin-service',
  'billing': 'billing-service',
  'crm': 'crm-service',
  'install': 'install-service',
  'plugin': 'plugin-service',
  'theme': 'theme-service',
  'reports': 'report-service',
  'inventory': 'inventory-service',
  'telephony': 'telephony-service',
  'helpdesk': 'helpdesk-service',
  'knowledge': 'knowledge-service',
  'workflow': 'workflow-service',
  'analytics': 'analytics-service',
  'recommendations': 'recommendation-service',
  'ai': 'ai-agent-service',
  'locations': 'location-service',
  'tenant': 'tenant-service',
  'sync': 'identity-service',
  'devices': 'identity-service',
  // COMP-004: registry.ts's "admin-users" entry is a pre-existing,
  // intentionally-tested shortcut (registry.test.ts) that sends
  // /api/v1/admin/users/* straight to identity-service, bypassing
  // admin-service — same shape as the sync/devices aliases above, just
  // previously missing from this map, which made every such chain read as
  // 'service-missing' even though the real identity-service route exists.
  'admin-users': 'identity-service',
  'queue': 'queue-service',
};

// ── Collect service routes from route files ───────────────────────────────────

const serviceRouteCache = new Map();

function getServiceRoutes(routeName) {
  if (serviceRouteCache.has(routeName)) return serviceRouteCache.get(routeName);

  const serviceDir = SERVICE_DIR_MAP[routeName];
  if (!serviceDir) {
    serviceRouteCache.set(routeName, []);
    return [];
  }

  const modulesDir = join(ROOT, 'services', serviceDir, 'src/modules');
  if (!existsSync(modulesDir)) {
    serviceRouteCache.set(routeName, []);
    return [];
  }

  const routes = [];
  // HTTP method regex — matches app.get/post/put/patch/delete("path", ...)
  const routeRe = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

  let moduleDirs;
  try { moduleDirs = readdirSync(modulesDir, { withFileTypes: true }); }
  catch { moduleDirs = []; }

  for (const entry of moduleDirs) {
    if (!entry.isDirectory()) continue;
    const moduleDir = join(modulesDir, entry.name);
    // Modules may split their routes across several files, plural or singular
    // (routes.ts, hierarchy-routes.ts, forecast-route.ts, …) — read them all.
    let moduleFiles;
    try { moduleFiles = readdirSync(moduleDir); }
    catch { continue; }
    for (const file of moduleFiles) {
      if (!/route(s)?\.ts$/.test(file) || file.endsWith('.test.ts')) continue;
      const src = readFileSync(join(moduleDir, file), 'utf8');
      let m;
      while ((m = routeRe.exec(src)) !== null) {
        routes.push({ method: m[1].toUpperCase(), path: m[2] });
      }
      routeRe.lastIndex = 0;
    }
  }

  // Also check top-level routes.ts
  const topRoutes = join(ROOT, 'services', serviceDir, 'src/routes.ts');
  if (existsSync(topRoutes)) {
    const src = readFileSync(topRoutes, 'utf8');
    let m;
    while ((m = routeRe.exec(src)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    routeRe.lastIndex = 0;
  }

  serviceRouteCache.set(routeName, routes);
  return routes;
}

// ── Migration table checker ───────────────────────────────────────────────────

const migrationCache = new Map();

function getServiceTables(routeName) {
  if (migrationCache.has(routeName)) return migrationCache.get(routeName);

  const serviceDir = SERVICE_DIR_MAP[routeName];
  if (!serviceDir) { migrationCache.set(routeName, new Set()); return new Set(); }

  const migrationsDir = join(ROOT, 'services', serviceDir, 'migrations');
  if (!existsSync(migrationsDir)) { migrationCache.set(routeName, new Set()); return new Set(); }

  const tables = new Set();
  let sqlFiles;
  try { sqlFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')); }
  catch { sqlFiles = []; }

  const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["']?[\w.]+["']?\.)?["']?([\w_]+)["']?\s*\(/gi;

  for (const file of sqlFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    let m;
    while ((m = createTableRe.exec(sql)) !== null) {
      tables.add(m[1].toLowerCase());
    }
    createTableRe.lastIndex = 0;
  }

  migrationCache.set(routeName, tables);
  return tables;
}

// ── Path matching ─────────────────────────────────────────────────────────────

function pathToPattern(path) {
  // Convert Fastify :param and Next.js ${var} template style to regex segments
  return path
    .replace(/\$\{[^}]+\}/g, ':param')   // template literals
    .replace(/:[\w]+/g, '[^/]+')           // :param → regex
    .replace(/\*/g, '.*')
    .replace(/\//g, '\\/');
}

function pathMatches(candidatePath, registeredPath) {
  // Normalize: strip trailing slash
  const norm = p => p.replace(/\/$/, '') || '/';
  const candidate = norm(candidatePath.split('?')[0]);
  const registered = norm(registeredPath);

  // Direct match
  if (candidate === registered) return true;

  // Pattern match (handle :params on both sides)
  try {
    const pattern = new RegExp(`^${pathToPattern(registered)}$`);
    return pattern.test(candidate);
  } catch {
    return false;
  }
}

function findMatchingRoute(upstreamPath, routeName, method = 'GET') {
  const handlers = getServiceRoutes(routeName);
  if (handlers.length === 0) return { found: false, reason: 'service-missing' };

  // First: exact or param match for requested method
  for (const h of handlers) {
    if (h.method === method && pathMatches(upstreamPath, h.path)) {
      return { found: true, matchedPath: h.path };
    }
  }

  // Second: any-method match (might be wrong method)
  for (const h of handlers) {
    if (pathMatches(upstreamPath, h.path)) {
      return { found: false, reason: 'method-mismatch', matchedPath: h.path };
    }
  }

  return { found: false, reason: 'route-not-found' };
}

// ── loaders.ts parser ─────────────────────────────────────────────────────────

function parseLoaders() {
  const loadersPath = join(ROOT, 'apps/web/src/app/_data/loaders.ts');
  if (!existsSync(loadersPath)) return new Map();

  const rawSrc = readFileSync(loadersPath, 'utf8');
  // Normalize template-literal interpolations before regex parsing so that
  // `${id}` doesn't cause [^}]* to stop inside a path string.
  const src = rawSrc.replace(/\$\{[^}]*\}/g, ':param');
  const loaderMap = new Map(); // name → [{ apiPath, isTemplate }]

  // Match exported functions and moduleLoader consts
  // Pattern 1: export async function FnName<...>(...)
  const funcRe = /export\s+async\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;

  // Pattern 2: export const FnName = moduleLoader("/path", ...)
  const moduleLoaderRe = /export\s+const\s+(\w+)\s*=\s*moduleLoader\(\s*["'`]([^"'`]+)["'`]/g;

  // Collect fetchJson calls within a function body
  const fetchJsonRe = /fetchJson(?:<[^>]*>)?\(\s*(?:["'`])([^"'`]+)(?:["'`])/g;

  // Process moduleLoader consts (simple case)
  let m;
  while ((m = moduleLoaderRe.exec(src)) !== null) {
    const name = m[1];
    const apiPath = m[2];
    loaderMap.set(name, [{ apiPath: normalizePath(apiPath), isTemplate: false }]);
  }

  // Process async functions
  while ((m = funcRe.exec(src)) !== null) {
    const name = m[1];
    const body = m[2];
    const paths = [];
    let fm;
    fetchJsonRe.lastIndex = 0;
    while ((fm = fetchJsonRe.exec(body)) !== null) {
      paths.push({ apiPath: normalizePath(fm[1]), isTemplate: fm[1].includes('${') });
    }
    if (paths.length > 0) {
      loaderMap.set(name, paths);
    }
  }

  return loaderMap;
}

function normalizePath(path) {
  // By the time this runs, every "${...}" interpolation in the source has
  // already been collapsed (upstream, in parseLoaders) to the literal
  // placeholder text ":param" (or ":id" for direct calls). Two distinct
  // source patterns produce that placeholder, and they must be told apart:
  //
  //   1. A real path-segment parameter, always preceded by "/" in the
  //      template, e.g. "/bills/${id}" -> "/bills/:param". This is a genuine
  //      wildcard path segment and must be kept so route matching still
  //      treats it as one.
  //   2. A data-dependent tail fused directly onto the previous path segment
  //      with no separator, e.g. "/finance/statements${qs}" ->
  //      "/finance/statements:param", where "qs" builds its own leading "?"
  //      internally (const qs = fy ? "?fy=${fy}" : ""). Nothing about the
  //      path changes here -- the whole optional query string lives inside
  //      the variable -- so this is not a path segment at all and must be
  //      dropped, not treated as an extra wildcard segment.
  //
  // The distinguishing signal is the character immediately before the
  // placeholder: "/" (or the template's own literal "?", handled by the
  // trailing strip below) means a real segment; anything else means a fused
  // non-path tail.
  let normalized = path.replace(/([^/?]):(?:param|id)\b/g, '$1');
  // A literal query string still present in the template (e.g. "?:param"
  // from "?${qs}", or a hardcoded "?active=true") -- strip it and anything
  // after.
  return normalized.replace(/[?].*$/, '');
}

// ── Page.tsx parser ───────────────────────────────────────────────────────────

function findPages() {
  const appDir = join(ROOT, 'apps/web/src/app/(app)');
  if (!existsSync(appDir)) return [];

  const pages = [];
  collectPages(appDir, pages, appDir);
  return pages;
}

function collectPages(dir, results, baseDir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPages(fullPath, results, baseDir);
    } else if (entry.name === 'page.tsx') {
      const relPath = relative(baseDir, fullPath);
      results.push({ filePath: fullPath, relPath });
    }
  }
}

function parsePageLoaders(filePath, loaderMap) {
  if (!existsSync(filePath)) return [];

  const src = readFileSync(filePath, 'utf8');

  // Find imports from _data/loaders
  const importedLoaders = new Set();
  const importRe = /import\s+\{([^}]+)\}\s+from\s+["'][^"']*_data\/loaders["']/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const names = m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '').trim());
    for (const n of names) {
      if (n && loaderMap.has(n)) importedLoaders.add(n);
    }
  }

  // Find calls to those loaders in the file body
  const calledLoaders = [];
  for (const loaderName of importedLoaders) {
    const callRe = new RegExp(`\\b${loaderName}\\s*\\(`, 'g');
    if (callRe.test(src)) {
      calledLoaders.push(loaderName);
    }
  }

  return calledLoaders;
}

// ── Module derivation ─────────────────────────────────────────────────────────

function deriveModule(relPath) {
  // relPath like "hr/payroll/salary-slips/page.tsx"
  const parts = relPath.replace(/\\/g, '/').split('/');
  return parts[0] ?? 'unknown';
}

function deriveScreenName(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  // Remove "page.tsx" at end
  parts.pop();
  if (parts.length === 0) return '/';
  return '/' + parts.join('/');
}

// ── Dead internal link scan (href → page.tsx / route.ts) ───────────────────────
//
// COMP-005: the loader-chain checks above only ever look at pages that call a
// data loader. Plain navigation links (dashboard action cards, hub tiles,
// marketing footer links, `window.location.href` redirects) point at a URL
// that is never checked against the actual Next.js route tree, so a typo or a
// renamed/removed page silently produces a dead link. This scans every
// `href` (JSX attribute, `Link` prop, or object-literal nav entry) under
// apps/web/src for an internal path (starts with "/", not "/api/…") and
// verifies a `page.tsx` or `route.ts` exists somewhere in apps/web/src/app
// whose derived URL matches it — route groups `(x)`, parallel-route slots
// `@x`, and dynamic segments `[id]` / `[...slug]` are all accounted for.

const WEB_APP_DIR = join(ROOT, 'apps/web/src/app');
const WEB_SRC_DIR = join(ROOT, 'apps/web/src');

function collectRouteTemplates() {
  const templates = [];

  function walk(dir, segmentsSoFar) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Route groups "(marketing)" and parallel-route slots "@modal" don't
        // contribute a URL segment — the URL skips straight past them.
        const isGroup = /^\(.*\)$/.test(entry.name);
        const isSlot = entry.name.startsWith('@');
        const nextSegments = (isGroup || isSlot) ? segmentsSoFar : [...segmentsSoFar, entry.name];
        walk(fullPath, nextSegments);
      } else if (/^page\.(tsx|jsx|ts|js)$/.test(entry.name) || /^route\.(ts|js)$/.test(entry.name)) {
        // page.tsx renders a URL; route.ts is a real navigable endpoint too
        // (e.g. GET /logout redirects through the IdP) — both count.
        templates.push(segmentsSoFar);
      }
    }
  }

  walk(WEB_APP_DIR, []);
  walkPublicAssets(templates);
  return templates;
}

// Static files under apps/web/public/ are served verbatim at their path
// (e.g. public/docs/api/openapi.yaml -> /docs/api/openapi.yaml) and are just
// as real a navigation target as a page.tsx -- a <a href download> to one of
// them is common (spec downloads, generated PDFs) and must not be flagged.
function walkPublicAssets(templates) {
  const PUBLIC_DIR = join(ROOT, 'apps/web/public');

  function walk(dir, segmentsSoFar) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, [...segmentsSoFar, entry.name]);
      } else {
        templates.push([...segmentsSoFar, entry.name]);
      }
    }
  }

  walk(PUBLIC_DIR, []);
}

function routeSegmentType(seg) {
  if (/^\[\.\.\.[^\]]+\]$/.test(seg) || /^\[\[\.\.\.[^\]]+\]\]$/.test(seg)) return 'multi'; // [...slug], [[...slug]]
  if (/^\[[^\]]+\]$/.test(seg)) return 'single'; // [id]
  return 'static';
}

function hrefPathname(raw) {
  return raw.split('#')[0].split('?')[0];
}

function hrefToSegments(pathname) {
  // A template literal like `/hr/employee/${id}` has already had its `${...}`
  // collapsed to a sentinel here so the segment is recognised as a wildcard
  // (we can't know the runtime value statically — never mind matching it).
  const withSentinel = pathname.replace(/\$\{[^}]*\}/g, '__PARAM__');
  return withSentinel.split('/').filter(Boolean).map(seg => ({
    value: seg,
    isParam: seg.includes('__PARAM__'),
  }));
}

function routeMatchesHref(routeSegs, hrefSegs) {
  let ri = 0, hi = 0;
  while (ri < routeSegs.length) {
    const type = routeSegmentType(routeSegs[ri]);
    if (type === 'multi') return true; // catch-all is always terminal in Next.js; consumes the rest
    if (hi >= hrefSegs.length) return false;
    if (type === 'single' || hrefSegs[hi].isParam) { ri++; hi++; continue; } // param on either side: can't disprove
    if (hrefSegs[hi].value !== routeSegs[ri]) return false; // static vs static: must match literally
    ri++; hi++;
  }
  return hi === hrefSegs.length;
}

function isInternalNavHref(raw) {
  if (typeof raw !== 'string') return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false; // relative/hash/mailto/tel/external
  if (raw.startsWith('/api/')) return false; // gateway call, not a page navigation
  return true;
}

function collectHrefs() {
  const hrefs = [];
  const hrefRe = /\bhref\s*[:=]\s*\{?\s*["'`]([^"'`]+)["'`]/g;

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
      if (/\.(test|stories)\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;

      const src = readFileSync(fullPath, 'utf8');
      hrefRe.lastIndex = 0;
      let m;
      while ((m = hrefRe.exec(src)) !== null) {
        hrefs.push({ file: relative(ROOT, fullPath), raw: m[1] });
      }
    }
  }

  walk(WEB_SRC_DIR);
  return hrefs;
}

function findDeadLinks() {
  const routeTemplates = collectRouteTemplates();
  const hrefs = collectHrefs();

  const checked = [];
  for (const h of hrefs) {
    if (!isInternalNavHref(h.raw)) continue;
    const pathname = hrefPathname(h.raw);
    const hrefSegs = hrefToSegments(pathname);
    const resolved = routeTemplates.some(rt => routeMatchesHref(rt, hrefSegs));
    checked.push({ file: h.file, href: h.raw, resolved });
  }

  const dead = checked.filter(c => !c.resolved);
  return { total: checked.length, dead };
}

// ── Fabricated-data detection (COMP-004) ────────────────────────────────────
//
// The loader-chain checks above only run for pages that call a real data
// loader. A page with ZERO loaders was always classified as a harmless
// "navigation hub" (NO_LOADER) — but that is exactly the shape every
// COMP-004 offender had: a `page.tsx` (or a client component it renders)
// with no loader import at all, and instead a hardcoded array of
// record-shaped object literals (MOCK_USERS, INITIAL_FLAGS, INITIAL_JOBS,
// INITIAL_GRANTS, the old admin/roles INITIAL_MATRIX/ROLES, ...) standing in
// for real backend data. This heuristic tells those two NO_LOADER shapes
// apart: a genuine hub page (dashboard tiles, a nav menu) has no such
// literal; a fabricated-data page does.
//
// Heuristic (regex-based, matching this script's existing style — not a
// full TS parser): find a module-scope `const NAME = [` (or `const NAME:
// Type[] = [`) whose name starts uppercase (this codebase's own convention
// for these constants — MOCK_*, INITIAL_*, and plain screaming-case lists
// like ROLES/PRESETS/FEATURE_KEYS all match), walk to the matching `]`, and
// count how many object-literal entries are inside and how many `key:`
// pairs they carry in total. Real record data consistently carries 3+
// fields per entry (id/name/email/status/...); short 2-field config lists
// (nav links, cron presets) fall under the threshold on purpose, so this
// does not fire on every constant array in the app — only ones dense enough
// to plausibly be standing in for a real dataset.
function findMatchingBracket(src, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const FABRICATED_MIN_ENTRIES = 3;
const FABRICATED_MIN_FIELDS_PER_ENTRY = 3;

function scanForFabricatedArray(src) {
  // Scoped to this codebase's own established naming convention for these
  // exact bugs (every genuine COMP-00x offender found: MOCK_USERS,
  // MOCK_JOBS, MOCK_SERVICES, MOCK_ISSUES, INITIAL_FLAGS, INITIAL_JOBS,
  // INITIAL_GRANTS, SAMPLE_HISTORY, ...) rather than every uppercase
  // module-scope array — a broader match also catches legitimate static UI
  // config (nav tiles, dashboards' MODULES/CONSOLES lists, default-value
  // templates) which would turn this into a repo-wide false-positive gate
  // instead of a targeted one.
  const declRe = /^const\s+((?:MOCK|INITIAL|SAMPLE|FAKE|DUMMY|STUB)_[A-Z0-9_]*)\s*(?::\s*[^=\n]+)?=\s*\[/gm;
  let m;
  while ((m = declRe.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1; // index of the '['
    const closeIdx = findMatchingBracket(src, openIdx, '[', ']');
    if (closeIdx === -1) continue;
    const body = src.slice(openIdx + 1, closeIdx);
    const entries = (body.match(/\{/g) || []).length;
    const colons = (body.match(/:/g) || []).length;
    if (entries >= FABRICATED_MIN_ENTRIES && colons >= entries * FABRICATED_MIN_FIELDS_PER_ENTRY) {
      return { name: m[1], entries, line: src.slice(0, m.index).split('\n').length };
    }
  }
  return null;
}

// Follows same-directory relative imports one level deep (`from "./Xxx"`) so
// a thin page.tsx that delegates its render to a co-located client component
// (the AdminUsersManager/FeatureFlagsManager split pattern this same gap
// fix uses) still gets its fabricated data caught, not just single-file
// pages.
function detectFabricatedData(pageFilePath) {
  const filesToScan = [pageFilePath];
  try {
    const src = readFileSync(pageFilePath, 'utf8');
    const relImportRe = /from\s+["']\.\/([A-Za-z0-9_-]+)["']/g;
    let im;
    const dir = dirname(pageFilePath);
    while ((im = relImportRe.exec(src)) !== null) {
      for (const ext of ['.tsx', '.ts']) {
        const candidate = join(dir, `${im[1]}${ext}`);
        if (existsSync(candidate)) { filesToScan.push(candidate); break; }
      }
    }
  } catch { /* page file unreadable — fall through with just itself */ }

  for (const file of filesToScan) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const hit = scanForFabricatedArray(src);
    if (hit) return { ...hit, file: relative(ROOT, file) };
  }
  return null;
}

// ── Status determination ──────────────────────────────────────────────────────


function computeStatus(row) {
  if (row.loaders.length === 0) return 'NO_LOADER'; // hub page, no data fetching
  if (!row.gateway) return 'MISSING';               // can't resolve gateway
  if (row.routeStatus === 'service-missing') return 'MISSING';
  if (row.routeStatus === 'route-not-found') return 'MISSING';
  if (row.routeStatus === 'method-mismatch') return 'MISMATCH';
  if (!row.tablesPresent) return 'MISSING';
  return 'WIRED';
}

// ── Main ──────────────────────────────────────────────────────────────────────

function run() {
  if (!jsonOnly) process.stdout.write('Parsing loaders.ts...\n');
  const loaderMap = parseLoaders();

  if (!jsonOnly) process.stdout.write(`Found ${loaderMap.size} loaders.\n`);

  if (!jsonOnly) process.stdout.write('Collecting pages...\n');
  const pages = findPages();
  if (!jsonOnly) process.stdout.write(`Found ${pages.length} pages.\n`);

  const rows = [];

  for (const page of pages) {
    const module = deriveModule(page.relPath);
    if (moduleFilter && module !== moduleFilter) continue;

    const screenName = deriveScreenName(page.relPath);
    const calledLoaders = parsePageLoaders(page.filePath, loaderMap);

    if (calledLoaders.length === 0) {
      // Hub / nav page — no loaders. Distinguish a genuine hub from a page
      // that's fabricating what looks like a real dataset instead of
      // loading one (COMP-004).
      const fabricated = detectFabricatedData(page.filePath);
      rows.push({
        module,
        screen: screenName,
        loaders: [],
        apiPaths: [],
        upstream: null,
        routeHandler: null,
        tablesPresent: null,
        status: fabricated ? 'FABRICATED_DATA' : 'NO_LOADER',
        detail: fabricated
          ? `no loader, but ${fabricated.name} in ${fabricated.file}:${fabricated.line} looks like ${fabricated.entries} hardcoded records`
          : 'navigation hub — no data loader',
      });
      continue;
    }

    // For pages with multiple loaders, create one row per (screen, loader, apiPath)
    for (const loaderName of calledLoaders) {
      const loaderPaths = loaderMap.get(loaderName) ?? [];

      if (loaderPaths.length === 0) {
        rows.push({
          module, screen: screenName, loaders: [loaderName],
          apiPaths: [], upstream: null, routeHandler: null,
          tablesPresent: null, status: 'MISSING', detail: 'loader has no fetchJson call',
        });
        continue;
      }

      // Use primary (first) fetchJson path for chain verification
      const { apiPath } = loaderPaths[0];

      const gateway = resolveGateway(apiPath);
      if (!gateway) {
        rows.push({
          module, screen: screenName, loaders: [loaderName],
          apiPaths: [apiPath], upstream: null, routeHandler: null,
          tablesPresent: null, status: 'MISSING', detail: `gateway cannot resolve ${apiPath}`,
        });
        continue;
      }

      const matchResult = findMatchingRoute(gateway.upstreamPath, gateway.routeName, 'GET');
      const tables = getServiceTables(gateway.routeName);
      const tablesPresent = tables.size > 0;

      const status = matchResult.found && tablesPresent ? 'WIRED'
        : !matchResult.found && matchResult.reason === 'method-mismatch' ? 'MISMATCH'
        : 'MISSING';

      rows.push({
        module,
        screen: screenName,
        loaders: [loaderName],
        apiPaths: [apiPath],
        upstream: `${gateway.routeName} → ${gateway.upstreamPath}`,
        routeHandler: matchResult.matchedPath ?? null,
        tablesPresent,
        status,
        detail: matchResult.found
          ? (tablesPresent ? 'ok' : 'no migration tables')
          : `${matchResult.reason}: ${gateway.upstreamPath}`,
      });
    }
  }

  // ── Counts ──────────────────────────────────────────────────────────────────
  const wired = rows.filter(r => r.status === 'WIRED').length;
  const missing = rows.filter(r => r.status === 'MISSING').length;
  const mismatch = rows.filter(r => r.status === 'MISMATCH').length;
  const noLoader = rows.filter(r => r.status === 'NO_LOADER').length;
  const fabricatedData = rows.filter(r => r.status === 'FABRICATED_DATA').length;
  const linkAudit = findDeadLinks();

  if (jsonOnly) {
    process.stdout.write(JSON.stringify({ rows, counts: { wired, missing, mismatch, noLoader, fabricatedData }, linkAudit }, null, 2));
    return;
  }

  // ── Write JSON output ────────────────────────────────────────────────────────
  const outDir = join(ROOT, 'scripts/contract');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'screen-map.json'), JSON.stringify({ rows, counts: { wired, missing, mismatch, noLoader, fabricatedData }, linkAudit }, null, 2));

  // ── Write Markdown table ─────────────────────────────────────────────────────
  const mdLines = [
    '# Screen Contract Map',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `**Summary:** ${wired} WIRED | ${missing} MISSING | ${mismatch} MISMATCH | ${noLoader} NO_LOADER | ${fabricatedData} FABRICATED_DATA`,
    '',
    '| module | screen | loader | apiPath | upstream | route? | table? | status |',
    '|--------|--------|--------|---------|----------|--------|--------|--------|',
  ];

  for (const row of rows) {
    const loader = row.loaders[0] ?? '—';
    const apiPath = row.apiPaths[0] ?? '—';
    const upstream = row.upstream ?? '—';
    const routeCheck = row.routeHandler ? `✓ \`${row.routeHandler}\`` : row.status === 'NO_LOADER' ? '—' : '✗';
    const tableCheck = row.tablesPresent === null ? '—' : row.tablesPresent ? '✓' : '✗';
    const statusEmoji = { WIRED: '✅', MISSING: '❌', MISMATCH: '⚠️', NO_LOADER: '—', FABRICATED_DATA: '🎭' }[row.status] ?? row.status;

    mdLines.push(`| ${row.module} | ${row.screen} | ${loader} | ${apiPath} | ${upstream} | ${routeCheck} | ${tableCheck} | ${statusEmoji} ${row.status} |`);
  }

  writeFileSync(join(outDir, 'screen-map.md'), mdLines.join('\n') + '\n');

  // ── Console summary ──────────────────────────────────────────────────────────
  process.stdout.write('\n');
  process.stdout.write('════════════════════════════════════════════════════════\n');
  process.stdout.write('  SCREEN CONTRACT MAP — STATIC ANALYSIS\n');
  process.stdout.write('════════════════════════════════════════════════════════\n');
  process.stdout.write(`  Total screens analyzed : ${rows.length}\n`);
  process.stdout.write(`  ✅ WIRED                : ${wired}\n`);
  process.stdout.write(`  ❌ MISSING              : ${missing}\n`);
  process.stdout.write(`  ⚠️  MISMATCH             : ${mismatch}\n`);
  process.stdout.write(`  —  NO_LOADER (hub pages): ${noLoader}\n`);
  process.stdout.write(`  🎭 FABRICATED_DATA        : ${fabricatedData}\n`);
  process.stdout.write('────────────────────────────────────────────────────────\n');

  if (missing > 0 || mismatch > 0 || fabricatedData > 0) {
    process.stdout.write('\nBROKEN CHAINS:\n');
    for (const row of rows.filter(r => r.status === 'MISSING' || r.status === 'MISMATCH' || r.status === 'FABRICATED_DATA')) {
      process.stdout.write(`  [${row.status}] ${row.module}${row.screen}  (${row.detail})\n`);
    }
  }

  process.stdout.write(`  🔗 DEAD LINKS           : ${linkAudit.dead.length} / ${linkAudit.total}\n`);
  process.stdout.write('\nDEAD INTERNAL LINKS:\n');
  if (linkAudit.dead.length > 0) {
    for (const d of linkAudit.dead) {
      process.stdout.write(`  [DEAD] ${d.file}  href="${d.href}"\n`);
    }
  } else {
    process.stdout.write('  (none)\n');
  }

  process.stdout.write('\nOutputs written to scripts/contract/screen-map.json + screen-map.md\n\n');
}

run();
