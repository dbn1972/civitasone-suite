#!/usr/bin/env node
/**
 * crm-link-integrity.mjs — CRM contract / link-integrity analyzer (finding R5)
 *
 * Proves two things statically, with no running services:
 *
 *   1. Every internal CRM link in the web app (`/crm/...` hrefs, DataTable
 *      rowLinkPrefix drill-throughs, router.push targets, screen-manifest nav
 *      paths) resolves to a Next.js route that actually exists under
 *      `apps/web/src/app`. A link that does not is a dead tile — the user
 *      clicks it and gets a 404.
 *
 *   2. Every CRM API path the web app calls (`/api/v1/crm/...` loaders and
 *      `/api/proxy/v1/crm/...` client fetches) resolves through the gateway
 *      registry onto a route that crm-service actually registers.
 *
 * Writes scripts/contract/crm-link-integrity.json (the CRM route inventory +
 * findings). Output is deterministic — no timestamps, everything sorted — so
 * the artefact can be committed and diffed.
 *
 * Usage:
 *   node scripts/contract/crm-link-integrity.mjs
 *   node scripts/contract/crm-link-integrity.mjs --report   # human summary
 */

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WEB_APP_DIR = join(ROOT, "apps/web/src/app");
const WEB_SRC_DIR = join(ROOT, "apps/web/src");
const CRM_MODULES_DIR = join(ROOT, "services/crm-service/src/modules");
const REGISTRY = join(ROOT, "services/gateway-service/src/registry.ts");
const SCREEN_MANIFEST = join(ROOT, "services/gateway-service/src/screen-manifest.ts");
const OUT = join(__dirname, "crm-link-integrity.json");

/** Placeholder substituted for a dynamic segment when resolving a link. */
const PARAM = "__param__";

// ── 1. Next.js route inventory ────────────────────────────────────────────────

/**
 * Walks the App Router tree and returns every addressable page route.
 * Route groups `(app)` are transparent, `_private` folders and `@slot`
 * parallel routes are not routable.
 */
function collectNextRoutes(dir, segments = [], acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
      if (/^\(.+\)$/.test(entry.name)) collectNextRoutes(full, segments, acc);
      else collectNextRoutes(full, [...segments, entry.name], acc);
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      acc.push("/" + segments.join("/"));
    }
  }
  return acc;
}

function nextRouteToRegex(route) {
  const body = route
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (/^\[\.\.\..+\]$/.test(seg)) return ".+";
      if (/^\[.+\]$/.test(seg)) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^/${body}$`);
}

// ── 2. crm-service HTTP route inventory ───────────────────────────────────────

function tsFilesUnder(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) tsFilesUnder(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * Extracts `app.get("/v1/crm/...")` style registrations from every file under
 * services/crm-service/src/modules. Scanning all files (not just routes.ts)
 * matters here: crm-service splits its surface across ~25 `*-routes.ts` files.
 */
function collectCrmHttpRoutes() {
  const routeRe = /\bapp\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]*)["'`]/g;
  const routes = [];
  for (const file of tsFilesUnder(CRM_MODULES_DIR)) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = routeRe.exec(src)) !== null) {
      routes.push({
        method: m[1].toUpperCase(),
        path: m[2],
        source: relative(ROOT, file),
      });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return routes;
}

function fastifyPathToRegex(path) {
  const body = path
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (seg === "*") return ".+";
      if (seg.startsWith(":")) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^/${body}$`);
}

// ── 3. Gateway prefix resolution ──────────────────────────────────────────────

function parseGatewayRegistry() {
  if (!existsSync(REGISTRY)) return [];
  const src = readFileSync(REGISTRY, "utf8");
  const blockRe = /\{\s*name:\s*["']([^"']+)["']\s*,\s*prefix:\s*["']([^"']+)["']([^}]*)\}/gs;
  const routes = [];
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const upstreamPath = m[3].match(/upstreamPath:\s*["']([^"']+)["']/);
    routes.push({ name: m[1], prefix: m[2], upstreamPath: upstreamPath ? upstreamPath[1] : null });
  }
  return routes;
}

/** Mirrors the gateway's longest-prefix-wins resolution. */
function resolveUpstream(gatewayRoutes, apiPath) {
  const pathname = apiPath.split("?")[0];
  const sorted = [...gatewayRoutes].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      const remainder = pathname.slice(route.prefix.length) || "/";
      const base = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
      return { name: route.name, upstreamPath: `${base}${remainder}` };
    }
  }
  return null;
}

// ── 4. Link + API reference extraction from the web app ───────────────────────

/** Collapses `${expr}` interpolations to a single dynamic segment marker. */
function normaliseTemplate(raw) {
  return raw.replace(/\$\{[^}]*\}/g, PARAM);
}

function stripQueryAndHash(path) {
  return path.split("?")[0].split("#")[0];
}

const LINK_PATTERNS = [
  // href="/crm/..." | href={"/crm/..."} | href={`/crm/${id}`}
  { re: /href[=:]\s*\{?\s*["'`](\/[^"'`]*)["'`]/g, kind: "href" },
  // <DataTable rowLinkPrefix="/crm/deals/" /> — prefix + row id
  { re: /rowLinkPrefix\s*=\s*\{?\s*["'`](\/[^"'`]*)["'`]/g, kind: "rowLinkPrefix" },
  // router.push("/crm/...") / redirect("/crm/...")
  { re: /(?:router\.push|router\.replace|redirect)\(\s*["'`](\/[^"'`]*)["'`]/g, kind: "navigate" },
];

function collectCrmLinks() {
  const links = [];
  for (const file of tsFilesUnder(WEB_SRC_DIR)) {
    const rel = relative(ROOT, file);
    // figma-designs/** is an imported design reference tree, not routable app
    // code — its paths are /app/crm/... and never rendered by the App Router.
    if (rel.includes("/figma-designs/")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { re, kind } of LINK_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const raw = m[1];
          if (!raw.startsWith("/crm")) continue;
          let resolved = stripQueryAndHash(normaliseTemplate(raw));
          if (kind === "rowLinkPrefix") resolved = `${resolved.replace(/\/$/, "")}/${PARAM}`;
          if (resolved !== "/") resolved = resolved.replace(/\/$/, "");
          links.push({ file: rel, line: i + 1, kind, target: raw, resolved });
        }
      }
    });
  }

  // Gateway screen manifest — drives the module nav rail served to the web app.
  if (existsSync(SCREEN_MANIFEST)) {
    const rel = relative(ROOT, SCREEN_MANIFEST);
    readFileSync(SCREEN_MANIFEST, "utf8").split("\n").forEach((line, i) => {
      const re = /\bpath:\s*["'`](\/[^"'`]*)["'`]/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (!m[1].startsWith("/crm")) continue;
        links.push({ file: rel, line: i + 1, kind: "nav", target: m[1], resolved: stripQueryAndHash(m[1]) });
      }
    });
  }

  links.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target));
  return links;
}

const API_REF_RE = /["'`]((?:\/api\/proxy|\/api)\/v1\/crm\/[^"'`]*)["'`]/g;

function collectCrmApiRefs() {
  const refs = [];
  for (const file of tsFilesUnder(WEB_SRC_DIR)) {
    const rel = relative(ROOT, file);
    if (rel.includes("/figma-designs/")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      API_REF_RE.lastIndex = 0;
      let m;
      while ((m = API_REF_RE.exec(line)) !== null) {
        const raw = m[1];
        // The Next.js proxy route rewrites /api/proxy/<rest> -> <gateway>/api/<rest>
        const gatewayPath = stripQueryAndHash(normaliseTemplate(raw)).replace("/api/proxy/", "/api/");
        refs.push({ file: rel, line: i + 1, ref: raw, gatewayPath });
      }
    });
  }
  refs.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ref.localeCompare(b.ref));
  return refs;
}

// ── 5. Analysis ───────────────────────────────────────────────────────────────

function analyse() {
  const nextRoutes = collectNextRoutes(WEB_APP_DIR).sort();
  const crmNextRoutes = nextRoutes.filter((r) => r === "/crm" || r.startsWith("/crm/"));
  const nextMatchers = nextRoutes.map(nextRouteToRegex);

  const crmApiRoutes = collectCrmHttpRoutes();
  const crmApiMatchers = crmApiRoutes.map((r) => ({ ...r, re: fastifyPathToRegex(r.path) }));

  const gatewayRoutes = parseGatewayRegistry();
  const crmGateway = gatewayRoutes.find((r) => r.name === "crm") ?? null;

  const links = collectCrmLinks().map((link) => ({
    ...link,
    ok: nextMatchers.some((re) => re.test(link.resolved)),
  }));

  const apiRefs = collectCrmApiRefs().map((ref) => {
    const resolved = resolveUpstream(gatewayRoutes, ref.gatewayPath);
    const upstreamPath = resolved?.upstreamPath ?? null;
    return {
      ...ref,
      upstreamService: resolved?.name ?? null,
      upstreamPath,
      // Path-level check: at least one crm-service registration matches. Method
      // is not asserted because the HTTP verb of a fetch() lives on a
      // different line from its URL and static verb attribution is unreliable.
      ok: upstreamPath !== null && crmApiMatchers.some((r) => r.re.test(upstreamPath)),
    };
  });

  return {
    gatewayPrefix: crmGateway?.prefix ?? null,
    counts: {
      crmApiRoutes: crmApiRoutes.length,
      crmNextRoutes: crmNextRoutes.length,
      webNextRoutes: nextRoutes.length,
      crmLinks: links.length,
      deadLinks: links.filter((l) => !l.ok).length,
      crmApiRefs: apiRefs.length,
      unknownApiRefs: apiRefs.filter((r) => !r.ok).length,
    },
    crmApiRoutes,
    crmNextRoutes,
    links,
    apiRefs,
    deadLinks: links.filter((l) => !l.ok),
    unknownApiRefs: apiRefs.filter((r) => !r.ok),
  };
}

const result = analyse();
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

if (process.argv.includes("--report")) {
  const c = result.counts;
  console.log(`CRM gateway prefix          : ${result.gatewayPrefix}`);
  console.log(`crm-service HTTP endpoints  : ${c.crmApiRoutes}`);
  console.log(`CRM Next.js page routes     : ${c.crmNextRoutes}`);
  console.log(`CRM links found in web app  : ${c.crmLinks}  (dead: ${c.deadLinks})`);
  console.log(`CRM API refs found in web   : ${c.crmApiRefs}  (unresolvable: ${c.unknownApiRefs})`);
  for (const l of result.deadLinks) console.log(`  [DEAD LINK] ${l.file}:${l.line} ${l.target} -> ${l.resolved}`);
  for (const r of result.unknownApiRefs) console.log(`  [DEAD API]  ${r.file}:${r.line} ${r.ref} -> ${r.upstreamPath ?? "unrouted"}`);
}

console.log(`crm-link-integrity: wrote ${relative(ROOT, OUT)}`);
