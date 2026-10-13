import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * SF-15 guard: writes are CQRS (202 + a consumer applies the change later), so a fixed timer followed by
 * `router.refresh()` / `location.reload()` only GUESSES that the write has landed. Use `useAcceptedWrite()` and the ds
 * `AcceptedNotice` (accepted -> poll a real read endpoint, or an honest "accepted" state with a manual Refresh).
 *
 * This fails on any NEW `setTimeout(...)` / `window.setTimeout(...)` whose arguments call `router.refresh` or
 * `location.reload` under src/app/(app). Allow-list: keep it tiny and justify every entry in a comment; it is a list of
 * file paths, not a baseline of existing violations (there are none).
 */
const ALLOW: Record<string, string> = {
  // "<path relative to src/app/(app)>": "why a timer-driven refresh is genuinely correct here",
  "hr/payroll/fnf/ComputeFnfForm.tsx":
    "A real bounded poll, not a completion guess: re-fetches the settlements list every FNF_POLL_INTERVAL_MS for at most FNF_POLL_MAX_TICKS (the row appearing IS the signal), after which it stops and a manual Refresh button remains (GAP-PAYROLL-FNF-04).",
};

const ROOT = path.join(__dirname, "..", "app", "(app)");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Text of the balanced (...) argument list that starts at the "(" at index `open`. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function findTimerReloads(src: string): number[] {
  const hits: number[] = [];
  const re = /\bsetTimeout\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const args = callArgs(src, m.index + m[0].length - 1);
    if (/\brouter\s*\.\s*refresh\b|\blocation\s*\.\s*reload\b|\.\s*reload\s*\(/.test(args)) {
      hits.push(src.slice(0, m.index).split("\n").length);
    }
  }
  return hits;
}

describe("no timer-based refresh/reload to fake write completion (SF-15)", () => {
  it("the detector flags the old pattern and ignores unrelated timers", () => {
    expect(findTimerReloads("setTimeout(() => router.refresh(), 600);")).toEqual([1]);
    expect(findTimerReloads("a;\nwindow.setTimeout(() => { void load(); router.refresh(); }, 1200);")).toEqual([2]);
    expect(findTimerReloads("setTimeout(() => window.location.reload(), 5)")).toEqual([1]);
    expect(findTimerReloads("setTimeout(() => setOpen(false), 600);\nrouter.refresh();")).toEqual([]);
  });

  it("src/app/(app) has no setTimeout that calls router.refresh or location.reload", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel in ALLOW) continue;
      for (const line of findTimerReloads(readFileSync(file, "utf8"))) offenders.push(`${rel}:${line}`);
    }
    expect(offenders, "use useAcceptedWrite() + <AcceptedNotice/> instead of a timer-based reload").toEqual([]);
  });
});
