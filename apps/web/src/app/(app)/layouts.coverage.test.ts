import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * SF-20: every top-level module directory under app/(app) must have a layout.tsx, so a new module
 * cannot ship with no entitlement/role decision. A directory may only be listed here when it is
 * genuinely ungated AND this comment says why. Today the list is empty: the intentionally open
 * modules (dashboard, help, settings, setup) have a layout that documents the decision.
 */
const UNGATED_ALLOW_LIST: readonly string[] = [];

describe("app/(app) top-level layouts (SF-20)", () => {
  const root = __dirname;
  const dirs = readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory());

  it("finds the module directories", () => {
    expect(dirs.length).toBeGreaterThan(40);
  });

  it("every top-level directory has a layout.tsx (or is on the allow-list)", () => {
    const missing = dirs.filter(
      (d) => !existsSync(join(root, d, "layout.tsx")) && !UNGATED_ALLOW_LIST.includes(d),
    );
    expect(missing).toEqual([]);
  });

  it("the allow-list names only directories that exist and still lack a layout", () => {
    const stale = UNGATED_ALLOW_LIST.filter((d) => !dirs.includes(d) || existsSync(join(root, d, "layout.tsx")));
    expect(stale).toEqual([]);
  });
});
