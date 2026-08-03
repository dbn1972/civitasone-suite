/**
 * screens.contract.test.ts
 *
 * Runs screen-map.mjs (static analyzer) and asserts:
 *   - Every screen with a loader is WIRED (gateway + route + table all present).
 *
 * Does NOT require running services — purely static analysis.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../..');
const SCREEN_MAP_PATH = join(ROOT, 'scripts/contract/screen-map.json');
const SCRIPT_PATH = join(ROOT, 'scripts/contract/screen-map.mjs');

type ScreenRow = {
  module: string;
  screen: string;
  loaders: string[];
  apiPaths: string[];
  upstream: string | null;
  routeHandler: string | null;
  tablesPresent: boolean | null;
  status: 'WIRED' | 'MISSING' | 'MISMATCH' | 'NO_LOADER';
  detail: string;
};

type ScreenMap = {
  rows: ScreenRow[];
  counts: { wired: number; missing: number; mismatch: number; noLoader: number };
};

let screenMap: ScreenMap;

beforeAll(() => {
  // Re-run the static analyzer to get a fresh map
  execSync(`node ${SCRIPT_PATH}`, { stdio: 'pipe', cwd: ROOT });
  screenMap = JSON.parse(readFileSync(SCREEN_MAP_PATH, 'utf8')) as ScreenMap;
}, 60_000);

describe('screen contract map', () => {
  it('screen-map.json is generated and non-empty', () => {
    expect(existsSync(SCREEN_MAP_PATH)).toBe(true);
    expect(screenMap.rows.length).toBeGreaterThan(0);
  });

  it('has no MISSING screens (gateway or route not found)', () => {
    const missing = screenMap.rows.filter(r => r.status === 'MISSING');
    if (missing.length > 0) {
      const details = missing.map(r => `  [MISSING] ${r.module}${r.screen}: ${r.detail}`).join('\n');
      expect.fail(
        `${missing.length} screen(s) have MISSING chains:\n${details}\n\n` +
        `Run: node scripts/contract/screen-map.mjs  to see full report.`,
      );
    }
  });

  it('has no MISMATCH screens (gateway resolves but route path wrong)', () => {
    const mismatched = screenMap.rows.filter(r => r.status === 'MISMATCH');
    if (mismatched.length > 0) {
      const details = mismatched.map(r => `  [MISMATCH] ${r.module}${r.screen}: ${r.detail}`).join('\n');
      expect.fail(
        `${mismatched.length} screen(s) have MISMATCH chains:\n${details}\n\n` +
        `Run: node scripts/contract/screen-map.mjs  to see full report.`,
      );
    }
  });

  it('all loader screens are WIRED', () => {
    const loaderScreens = screenMap.rows.filter(r => r.status !== 'NO_LOADER');
    const unwired = loaderScreens.filter(r => r.status !== 'WIRED');
    if (unwired.length > 0) {
      const details = unwired
        .sort((a, b) => a.module.localeCompare(b.module))
        .map(r => `  [${r.status}] ${r.module}${r.screen}  loader=${r.loaders[0] ?? '—'}  api=${r.apiPaths[0] ?? '—'}`)
        .join('\n');
      expect.fail(
        `${unwired.length}/${loaderScreens.length} screens not fully wired:\n${details}\n`,
      );
    }
  });

  it('every loader api path is addressed through the /api gateway prefix', () => {
    // A path written as "/v1/helpdesk/..." still reaches the service at runtime,
    // because fetchJson prepends "/api". But no gateway registry prefix matches
    // it, so the screen's chain cannot be proven and the screen is unverifiable.
    const offenders = screenMap.rows
      .flatMap(r => r.apiPaths.map(p => ({ screen: `${r.module}${r.screen}`, path: p })))
      .filter(e => !e.path.startsWith('/api/'));
    expect(offenders.map(e => `${e.screen} → ${e.path}`)).toEqual([]);
  });

  it('no loader api path interpolates a segment without its separator', () => {
    // `${base}${qs}` where qs carries its own "?" collapses to
    // "/library/books:param", which matches no registered route. The "?" or "/"
    // must be literal in the template so the path stays statically resolvable.
    const offenders = screenMap.rows
      .flatMap(r => r.apiPaths.map(p => ({ screen: `${r.module}${r.screen}`, path: p })))
      .filter(e => /[^/]:(?:param|id)\b/.test(e.path));
    expect(offenders.map(e => `${e.screen} → ${e.path}`)).toEqual([]);
  });

  it.each([
    ['estab', '/estab/library', 'getLibraryBooks'],
    ['estab', '/estab/library/issues', 'getLibraryBooks'],
    ['estab', '/estab/library/issues', 'getLibraryIssues'],
    ['helpdesk', '/helpdesk/catalogue', 'getCatalogueOfferings'],
    ['helpdesk', '/helpdesk/catalogue/[id]', 'getCatalogueOffering'],
    ['helpdesk', '/helpdesk/catalogue/my-requests', 'getMyServiceRequests'],
  ])('%s %s stays wired via %s', (module, screen, loader) => {
    const row = screenMap.rows.find(
      r => r.module === module && r.screen === screen && r.loaders.includes(loader),
    );
    expect(row, `no screen-map row for ${module}${screen} loader=${loader}`).toBeDefined();
    expect(row!.status).toBe('WIRED');
    expect(row!.upstream).toBeTruthy();
    expect(row!.routeHandler).toBeTruthy();
    expect(row!.tablesPresent).toBe(true);
  });

  it('reports wired screen count (informational)', () => {
    const { wired, missing, mismatch, noLoader } = screenMap.counts;
    // Always passes — just prints the baseline
    console.log(
      `\nContract baseline: WIRED=${wired}, MISSING=${missing}, MISMATCH=${mismatch}, NO_LOADER=${noLoader}`,
    );
    expect(typeof wired).toBe('number');
  });
});
