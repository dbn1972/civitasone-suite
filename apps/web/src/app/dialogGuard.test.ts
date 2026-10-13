import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * W1 SF-19 grep guard. Under apps/web/src/app (outside `_components/ds/`):
 *
 *  1. No hand-rolled dialog: a host element (`<div>`, `<section>`, `<dialog>` ...)
 *     carrying `role="dialog"` / `role="alertdialog"` / `aria-modal`. Dialogs are
 *     built on `ds/Modal` (focus trap, inert background, Escape, focus restore) or
 *     `ds/ConfirmDialog`. Passing `role="alertdialog"` as a PROP to a component
 *     (`<Modal role="alertdialog">`) is fine and is not matched.
 *  2. No native `window.confirm(...)` / `confirm("...")`: it cannot be styled,
 *     translated, focus-trapped or given a reason field. Use `ds/ConfirmDialog`.
 *     (A local helper named `confirm` that takes a reason or no argument is not
 *     the native one and is not matched.)
 *
 * Exceptions live in ALLOW below, each with the reason. Add to it only with a
 * reviewable justification -- there is deliberately no baseline file. An ALLOW
 * entry that no longer matches anything fails the test, so the list cannot rot.
 */
const APP_DIR = __dirname;
const DS_DIR = join(APP_DIR, "_components", "ds") + sep;

/** `relative/path.tsx` -> why a hand-rolled dialog is acceptable there. */
const ALLOW: Record<string, string> = {
  "_components/AskCivitasOnePanel.tsx":
    "Floating bottom-right assistant chat panel, deliberately non-modal in layout (the page stays visible beside it). ds/Modal is a centred, page-inerting overlay and would change that product behaviour. Tracked for SF-19b.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !p.startsWith(DS_DIR)) out.push(p);
  }
  return out;
}

/** Drop block and line comments (incl. JSX `{/* ... *\/}`) so prose can mention the patterns. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

const DIALOG_ATTR = /\brole=\{?\s*["'](?:alert)?dialog["']|\baria-modal\b/g;

/** Names of the JSX tag each dialog attribute sits on, for host (lowercase) tags only. */
export function findHandRolledDialogs(src: string): string[] {
  const code = stripComments(src);
  const hits: string[] = [];
  for (const m of code.matchAll(DIALOG_ATTR)) {
    const before = code.slice(0, m.index);
    const tagStart = before.search(/<[A-Za-z][\w.]*(?=[^<]*$)/);
    if (tagStart === -1) continue;
    const name = /^<([A-Za-z][\w.]*)/.exec(before.slice(tagStart))?.[1] ?? "";
    if (/^[a-z]/.test(name)) hits.push(`<${name} ${m[0]}`);
  }
  for (const m of code.matchAll(/<dialog\b/g)) hits.push(m[0]);
  return hits;
}

const NATIVE_CONFIRM = /\b(?:window|globalThis)\.confirm\s*\(|(?<![\w.$])confirm\s*\(\s*(?:["'`]|t\()/g;

export function findNativeConfirms(src: string): string[] {
  return [...stripComments(src).matchAll(NATIVE_CONFIRM)].map((m) => m[0]);
}

describe("W1 SF-19 detectors", () => {
  it("flags a host element with role=dialog / alertdialog / aria-modal", () => {
    expect(findHandRolledDialogs('<div role="dialog" aria-modal="true">')).toHaveLength(2);
    expect(findHandRolledDialogs('<div\n  role="alertdialog"\n>')).toHaveLength(1);
    expect(findHandRolledDialogs("<section role={'dialog'}>")).toHaveLength(1);
    expect(findHandRolledDialogs("<dialog open>")).toHaveLength(1);
  });

  it("does not flag the Modal prop, comments or other roles", () => {
    expect(findHandRolledDialogs('<Modal open role="alertdialog" title="x">')).toEqual([]);
    expect(findHandRolledDialogs('{/* role="dialog" aria-modal */}')).toEqual([]);
    expect(findHandRolledDialogs('// <div role="dialog">')).toEqual([]);
    expect(findHandRolledDialogs('<div role="status">')).toEqual([]);
  });

  it("flags native confirm calls but not a local confirm(reason) helper", () => {
    expect(findNativeConfirms('if (!window.confirm("Sure?")) return;')).toHaveLength(1);
    expect(findNativeConfirms('if (!confirm("Sure?")) return;')).toHaveLength(1);
    expect(findNativeConfirms("if (!confirm(t('x'))) return;")).toHaveLength(1);
    expect(findNativeConfirms("onConfirm={(reason) => void confirm(reason)}")).toEqual([]);
    expect(findNativeConfirms("async function confirm(reason?: string) {}")).toEqual([]);
    expect(findNativeConfirms('// window.confirm("x") was replaced')).toEqual([]);
  });
});

describe("W1 SF-19: no hand-rolled dialogs or native confirm() outside ds/", () => {
  const files = walk(APP_DIR);
  const rel = (f: string) => relative(APP_DIR, f).split(sep).join("/");

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("has no role=dialog / alertdialog / aria-modal host elements (use ds/Modal)", () => {
    const offenders = files
      .map((f) => ({ f: rel(f), hits: findHandRolledDialogs(readFileSync(f, "utf8")) }))
      .filter(({ f, hits }) => hits.length > 0 && !(f in ALLOW))
      .map(({ f, hits }) => `${f}: ${hits.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("has no native window.confirm() (use ds/ConfirmDialog)", () => {
    const offenders = files
      .map((f) => ({ f: rel(f), hits: findNativeConfirms(readFileSync(f, "utf8")) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ f, hits }) => `${f}: ${hits.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("keeps every ALLOW entry live (still present and still matching)", () => {
    for (const f of Object.keys(ALLOW)) {
      const abs = join(APP_DIR, f);
      expect(findHandRolledDialogs(readFileSync(abs, "utf8")).length, `${f} no longer needs its ALLOW entry`).toBeGreaterThan(0);
    }
  });
});
