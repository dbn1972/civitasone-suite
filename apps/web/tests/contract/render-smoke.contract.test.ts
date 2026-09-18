/**
 * render-smoke.contract.test.ts
 *
 * COMP-006 (tranche 2 -- render-smoke / loader-manifest feature).
 *
 * screens.contract.test.ts's loader-chain checks only ever look at pages
 * screen-map.mjs's parseLoaders() can see importing + calling a named
 * function from apps/web/src/app/_data/loaders.ts. A page with zero such
 * calls is classified NO_LOADER and completely exempt from the Screen
 * Verification Gate -- but "no loader the static parser can see" covers at
 * least three very different real shapes, and the gate had no way to tell
 * them apart:
 *
 *   1. A genuine navigation hub / write-only form -- no data to fetch,
 *      NO_LOADER is the correct, permanent classification.
 *   2. A page that fetches real data by calling fetchJson() from
 *      @/app/_data/apiClient DIRECTLY, bypassing the loaders.ts indirection
 *      the static parser looks for entirely (confirmed on the current
 *      NO_LOADER set: ~154/544 screens reference fetchJson/apiClient
 *      directly -- e.g. apps/web/src/app/(app)/assets/insurance/[id]/
 *      page.tsx). These are real, working screens the parser is simply
 *      blind to, not hub pages.
 *   3. A page that is actually broken -- throws on render, or renders
 *      nothing meaningful -- which today is silently indistinguishable
 *      from (1).
 *
 * No amount of additional static parsing closes this gap (see the COMP-006
 * row in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md -- the previous tranche,
 * PR #1380, already fixed the two real parser bugs that existed and
 * explicitly punted the rest here): only actually rendering the page proves
 * which of the three it is. This file does that in two parts:
 *
 *   - A REGRESSION GATE (blocking): every screen tracked in the reviewed
 *     scripts/contract/loader-manifest.json ledger must still render
 *     cleanly. An entry only ever enters that file via a human/fixer
 *     reviewing a real passing render in a PR -- same trust model as
 *     scripts/contract/known-broken-chains.json.
 *   - A DISCOVERY SWEEP (informational): every *current* NO_LOADER screen
 *     is rendered and the result written to scripts/contract/
 *     render-smoke-report.json, so a future tranche can review it and
 *     promote newly-confirmed screens into the ledger.
 *
 * Rendering convention mirrors the existing apps/web/src/**\/page.test.tsx
 * files: a Server Component page.tsx is called directly and its returned
 * JSX awaited (`await Page(props)`); a "use client" page.tsx is rendered
 * through JSX (`<Page {...props} />`) instead, so React's hook dispatcher is
 * active (calling a hook-using component as a plain function throws
 * "Invalid hook call"). Every render is wrapped in the same
 * NextIntlClientProvider used by existing client-component tests (see
 * vitest.setup.ts's next-intl/server mock comment) -- a Server Component
 * page commonly renders client children that call the client-side
 * useTranslations() hook. fetchJson/fetchJsonWithFallback are mocked to a
 * generic, safely-empty LoaderResult so a bucket-(2) page above renders its
 * real empty-state logic instead of attempting a network call (there is no
 * backend running in this test).
 *
 * A screen counts as covered by the Screen Verification Gate once it is
 * WIRED *or* has a loader-manifest entry backed by a passing render here --
 * see the "Gate — fail on MISSING..." step in .github/workflows/ci.yml for
 * the coverage-percentage ratchet that reads this file's generated report.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, Component, type ReactNode } from 'react';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import enMessages from '@/messages/en.json';
import { ToastProvider } from '@/app/_components/ds';

// A handful of NO_LOADER pages throw only once mounted -- from a useEffect's
// state update, or (confirmed against two real pages during this sweep:
// citizen/rti/[id]/RTIDetailClient.tsx, settings/branding/page.tsx) from
// React 18 concurrent rendering's own synchronous *recovery* pass after an
// initial error, which runs on a scheduled callback outside the call stack
// of the original render(...) call -- a plain try/catch around render(...)
// cannot see either. A React error boundary can: it catches an error in its
// subtree regardless of which render pass produced it, as long as it's
// still part of the same mounted tree, which is exactly the guarantee this
// harness needs to keep one broken screen from crashing the whole sweep.
class SmokeErrorBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { errored: boolean }> {
  state = { errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.errored ? null : this.props.children;
  }
}

const WEB_ROOT = join(import.meta.dirname, '../..');
const REPO_ROOT = join(import.meta.dirname, '../../../..');
const APP_DIR = join(WEB_ROOT, 'src/app/(app)');
const SCREEN_MAP_PATH = join(REPO_ROOT, 'scripts/contract/screen-map.json');
const MANIFEST_PATH = join(REPO_ROOT, 'scripts/contract/loader-manifest.json');
const REPORT_PATH = join(REPO_ROOT, 'scripts/contract/render-smoke-report.json');

type ScreenRow = {
  module: string;
  screen: string;
  status: 'WIRED' | 'MISSING' | 'MISMATCH' | 'NO_LOADER' | 'FABRICATED_DATA';
};
type ScreenMap = {
  rows: ScreenRow[];
  counts: { totalPages?: number; wired: number; noLoader: number };
};
type ManifestEntry = { module: string; screen: string };
type Manifest = { _comment: string; entries: ManifestEntry[] };
type RenderVerdict = { verdict: 'PASS' | 'FAIL'; reason: string };

const key = (r: { module: string; screen: string }) => `${r.module}::${r.screen}`;

// The global next/navigation mock in vitest.setup.ts only exports
// useRouter/usePathname/useSearchParams/redirect -- enough for the
// hand-picked pages existing page.test.tsx files cover, but this sweep hits
// every NO_LOADER page, and two more real, common Next.js APIs showed up
// missing on the first full run: notFound() (a detail page's standard
// "record not found" exit, e.g. citizen/rti/[id]) and useParams() (the
// client-side equivalent of the `params` page prop, used by client
// components that read the dynamic segment themselves instead of receiving
// it as a prop). Overriding the mock per-file (not editing the shared
// vitest.setup.ts) keeps this fix scoped to the one place that needs it.
// currentScreenParams is updated per screen in renderScreen() below so
// useParams() reflects whichever screen is currently being rendered.
let currentScreenParams: Record<string, string | string[]> = {};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => currentScreenParams,
}));

// jsdom has never implemented Element.scrollIntoView (a longstanding,
// well-known gap -- https://github.com/jsdom/jsdom/issues/1695) -- a no-op
// polyfill, same treatment as vitest.setup.ts's own matchMedia polyfill.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// A generic, safely-empty LoaderResult -- see bucket (2) in the header
// comment. Real per-page tests (e.g. assets/insurance/page.test.tsx) mock
// this same module with page-specific fixture data; this file can't do that
// for 544 different, unknown pages, so it uses the most defensively-shaped
// empty response instead: enough for a page's own "no rows" / "not found"
// empty-state branch to take over, same as a real empty tenant would hit.
vi.mock('@/app/_data/apiClient', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const empty = { data: [], source: 'api' as const };
  return {
    ...actual,
    fetchJson: async () => empty,
    fetchJsonWithFallback: async () => empty,
  };
});

// A handful of pages call the browser fetch() directly in a useEffect
// instead of going through @/app/_data/apiClient (same architectural
// bypass as bucket (2) in the header comment, one layer further down) --
// e.g. designer/library/PackLibraryClient.tsx. jsdom has no real origin to
// resolve a relative "/api/..." URL against, so an unmocked fetch() throws
// a URL-parse TypeError -- and because it's fired from an effect, that
// throw lands on a later microtask, after renderScreen()'s own try/catch
// has already returned, escaping it entirely and crashing the whole sweep.
// Stubbing global fetch the same defensively-empty way as apiClient above
// fixes both problems at once: no more URL-parse crash, and any remaining
// per-screen effect error still has a real page bug to report, not this
// environment artifact.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [] }),
  text: async () => '{"data":[]}',
})));

/** Builds a `params` object with a placeholder value for every `[seg]` / `[...seg]` in the screen path. */
function paramsForScreen(screen: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const m of screen.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)) {
    params[m[2]] = m[1] ? ['smoke-test-value'] : 'smoke-test-value';
  }
  return params;
}

/** Next.js decides server vs. client the same way: the "use client" directive at the top of the file. */
function isClientComponent(src: string): boolean {
  const head = src.split('\n').slice(0, 3).join('\n');
  return /^\s*["']use client["'];?\s*$/m.test(head);
}

async function renderScreen(row: { module: string; screen: string }): Promise<RenderVerdict> {
  const relDir = row.screen.slice(1);
  const filePath = join(APP_DIR, relDir, 'page.tsx');
  if (!existsSync(filePath)) {
    return { verdict: 'FAIL', reason: `page.tsx not found at ${filePath}` };
  }

  try {
    const src = readFileSync(filePath, 'utf8');
    const clientComponent = isClientComponent(src);
    const mod = (await import(pathToFileURL(filePath).href)) as { default?: unknown };
    const Page = mod.default;
    if (typeof Page !== 'function') {
      return { verdict: 'FAIL', reason: 'no default function export' };
    }

    const screenParams = paramsForScreen(row.screen);
    currentScreenParams = screenParams; // read by the useParams() mock above
    const props = { params: screenParams, searchParams: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = clientComponent ? createElement(Page as any, props) : await (Page as any)(props);

    let boundaryError: unknown = null;
    // children is passed inside each props object (not as a 3rd positional
    // arg) because both NextIntlClientProvider's and SmokeErrorBoundary's
    // prop types declare `children: ReactNode` as a required named field --
    // createElement's overloads don't resolve cleanly against that shape
    // when children is supplied positionally instead (TS2769).
    const boundedUi = createElement(SmokeErrorBoundary, { onError: (e: unknown) => { boundaryError = e; }, children: ui });
    const withToast = createElement(ToastProvider, null, boundedUi);
    const { container, unmount } = render(
      createElement(NextIntlClientProvider, { locale: 'en', messages: enMessages, children: withToast }),
    );
    // Flush one tick so a useEffect's immediately-fired async work (a fetch,
    // typically) settles, and so a concurrent-mode recovery re-render (see
    // SmokeErrorBoundary above) has a chance to run and be caught by the
    // boundary before this function decides pass/fail.
    await new Promise(resolve => setTimeout(resolve, 0));
    const text = container.textContent?.trim() ?? '';
    unmount();

    if (boundaryError) {
      const message = boundaryError instanceof Error ? boundaryError.message : String(boundaryError);
      return { verdict: 'FAIL', reason: message.split('\n')[0].slice(0, 200) };
    }
    if (text.length === 0) {
      return { verdict: 'FAIL', reason: 'rendered no visible text content' };
    }
    return { verdict: 'PASS', reason: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { verdict: 'FAIL', reason: message.split('\n')[0].slice(0, 200) };
  }
}

let screenMap: ScreenMap;
let manifest: Manifest;
let noLoaderRows: ScreenRow[];

beforeAll(() => {
  if (!existsSync(SCREEN_MAP_PATH)) {
    throw new Error('screen-map.json not found. Run: node scripts/contract/screen-map.mjs first');
  }
  screenMap = JSON.parse(readFileSync(SCREEN_MAP_PATH, 'utf8')) as ScreenMap;
  noLoaderRows = screenMap.rows.filter(r => r.status === 'NO_LOADER');
  manifest = existsSync(MANIFEST_PATH)
    ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest)
    : { _comment: '', entries: [] };
}, 30_000);

describe('render-smoke (NO_LOADER screens, COMP-006 tranche 2)', () => {
  it('screen-map.json and loader-manifest.json are both readable', () => {
    expect(screenMap.rows.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.entries)).toBe(true);
  });

  it('every loader-manifest entry still corresponds to a real NO_LOADER screen (ledger staleness check)', () => {
    const noLoaderKeys = new Set(noLoaderRows.map(key));
    const stale = manifest.entries.filter(e => !noLoaderKeys.has(key(e)));
    if (stale.length > 0) {
      const details = stale.map(e => `  ${e.module}${e.screen}`).join('\n');
      expect.fail(
        `${stale.length} loader-manifest.json entry(ies) no longer correspond to a NO_LOADER screen ` +
        `(the screen was removed, renamed, or now has a real loader -- in which case it's already ` +
        `covered via WIRED and this entry is redundant). Remove them:\n${details}\n`,
      );
    }
  });

  it('every loader-manifest entry still render-smoke-passes (regression gate)', async () => {
    const noLoaderKeys = new Set(noLoaderRows.map(key));
    const toCheck = manifest.entries.filter(e => noLoaderKeys.has(key(e)));
    const regressions: string[] = [];

    for (const entry of toCheck) {
      const result = await renderScreen(entry);
      if (result.verdict !== 'PASS') {
        regressions.push(`  ${entry.module}${entry.screen}: ${result.reason}`);
      }
    }

    if (regressions.length > 0) {
      expect.fail(
        `${regressions.length}/${toCheck.length} loader-manifest.json screen(s) no longer render cleanly ` +
        `(regression -- fix the page, or remove the entry and file a gap):\n${regressions.join('\n')}\n`,
      );
    }
  }, 60_000);

  it('render-smoke sweep across all current NO_LOADER screens (informational — generates render-smoke-report.json)', async () => {
    const results: Array<{ module: string; screen: string } & RenderVerdict> = [];
    for (const row of noLoaderRows) {
      const result = await renderScreen(row);
      results.push({ module: row.module, screen: row.screen, ...result });
    }

    const passed = results.filter(r => r.verdict === 'PASS').length;
    const totalPages = screenMap.counts.totalPages;
    const manifestCount = manifest.entries.length;
    const coveragePct = totalPages
      ? Number((((totalPages - noLoaderRows.length) + manifestCount) / totalPages * 100).toFixed(1))
      : null;

    writeFileSync(REPORT_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      counts: {
        totalNoLoader: noLoaderRows.length,
        renderPassed: passed,
        renderFailed: results.length - passed,
        manifestConfirmed: manifestCount,
      },
      coveragePct,
      results,
    }, null, 2));

    console.log(
      `\nRender-smoke sweep: ${passed}/${results.length} NO_LOADER screens render cleanly. ` +
      `${manifestCount} confirmed in loader-manifest.json. Screen Verification Gate coverage: ${coveragePct}%. ` +
      `See scripts/contract/render-smoke-report.json for the full per-screen breakdown (candidates for ` +
      `promotion into loader-manifest.json in a future tranche).`,
    );

    expect(results.length).toBe(noLoaderRows.length);
  }, 180_000);
});
