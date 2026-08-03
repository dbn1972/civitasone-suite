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
  'audit-events': 'audit-service',
  'audit': 'audit-service',
  'notification': 'notification-service',
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
  // Replace template literals ${...} with :param placeholder
  return path.replace(/\$\{[^}]+\}/g, ':id').replace(/[?].*$/, '');
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
      // Hub / nav page — no loaders
      rows.push({
        module,
        screen: screenName,
        loaders: [],
        apiPaths: [],
        upstream: null,
        routeHandler: null,
        tablesPresent: null,
        status: 'NO_LOADER',
        detail: 'navigation hub — no data loader',
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

  if (jsonOnly) {
    process.stdout.write(JSON.stringify({ rows, counts: { wired, missing, mismatch, noLoader } }, null, 2));
    return;
  }

  // ── Write JSON output ────────────────────────────────────────────────────────
  const outDir = join(ROOT, 'scripts/contract');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'screen-map.json'), JSON.stringify({ rows, counts: { wired, missing, mismatch, noLoader } }, null, 2));

  // ── Write Markdown table ─────────────────────────────────────────────────────
  const mdLines = [
    '# Screen Contract Map',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `**Summary:** ${wired} WIRED | ${missing} MISSING | ${mismatch} MISMATCH | ${noLoader} NO_LOADER`,
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
    const statusEmoji = { WIRED: '✅', MISSING: '❌', MISMATCH: '⚠️', NO_LOADER: '—' }[row.status] ?? row.status;

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
  process.stdout.write('────────────────────────────────────────────────────────\n');

  if (missing > 0 || mismatch > 0) {
    process.stdout.write('\nBROKEN CHAINS:\n');
    for (const row of rows.filter(r => r.status === 'MISSING' || r.status === 'MISMATCH')) {
      process.stdout.write(`  [${row.status}] ${row.module}${row.screen}  (${row.detail})\n`);
    }
  }

  process.stdout.write('\nOutputs written to scripts/contract/screen-map.json + screen-map.md\n\n');
}

run();
