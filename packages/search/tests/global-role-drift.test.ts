/**
 * Drift guard: the catalogue's `readRoles` are copies of the owning services' read guards. This test reads those guards
 * from the services' SOURCE and fails when the two stop matching, in either direction, so a role added to (or removed
 * from) a module's read route cannot silently leave global search too wide or too narrow.
 *
 * Every catalogue type MUST have an entry in GUARDS (checked below), so a new type cannot ship unguarded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_ENTITY_TYPES, GLOBAL_ENTITY_TYPE_LIST, type GlobalEntityType } from "../src/global/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Guard {
  /** Service source file holding the role constants, relative to the repo root. */
  file: string;
  /** Role constants whose union is what the read route accepts. */
  constants: string[];
  /** A read route of that record, as written in `app.get(...)`. */
  route: string;
  /** Constant(s) that route is guarded by. Defaults to `constants`. When it is wider than `constants`, the catalogue is
   *  deliberately narrower (a per-record scope an index cannot mirror) and must stay a SUBSET of the route guard. */
  routeGuard?: string[];
}

const GUARDS: Record<GlobalEntityType, Guard> = {
  "finance.voucher": { file: "services/finance-service/src/modules/gl/routes.ts", constants: ["READER_ROLES"], route: 'app.get("/v1/finance/journals"' },
  "finance.bill": { file: "services/finance-service/src/modules/payments/routes.ts", constants: ["READER_ROLES"], route: 'app.get("/v1/finance/bills/:id"' },
  "finance.vendor": { file: "services/finance-service/src/modules/masters/routes.ts", constants: ["READER_ROLES"], route: 'app.get("/v1/finance/vendors/:id"' },
  "hrms.employee": { file: "services/hrms-service/src/modules/employee/routes.ts", constants: ["HR_ROLES", "PAYROLL_DIRECTORY_ROLES"], route: 'app.get("/v1/hrms/employees"', routeGuard: ["DIRECTORY_ROLES"] },
  "procurement.indent": { file: "services/procurement-service/src/modules/indent/routes.ts", constants: ["READER_ROLES"], route: 'app.get("/v1/procurement/indents"' },
  "procurement.po": { file: "services/procurement-service/src/modules/po/routes.ts", constants: ["READER_ROLES"], route: 'app.get("/v1/procurement/pos"' },
};

/** Resolve `const NAME = [ "a", ...OTHER, "b" ]` (same file) to its string members. */
export function resolveRoles(source: string, name: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(name)) throw new Error(`cyclic role constant ${name}`);
  seen.add(name);
  const m = new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!m) throw new Error(`role constant ${name} not found`);
  const out: string[] = [];
  for (const raw of m[1]!.split(",").map((x) => x.trim()).filter(Boolean)) {
    const lit = /^"([^"]+)"$/.exec(raw);
    const spread = /^\.\.\.\s*([A-Za-z0-9_]+)$/.exec(raw);
    if (lit) out.push(lit[1]!);
    else if (spread) out.push(...resolveRoles(source, spread[1]!, new Set(seen)));
    else throw new Error(`cannot parse role item ${raw} in ${name}`);
  }
  return out;
}

describe("catalogue read roles match the owning service's read guard", () => {
  it("every catalogue type has a guard entry (and no guard is orphaned)", () => {
    expect(Object.keys(GUARDS).sort()).toEqual([...GLOBAL_ENTITY_TYPE_LIST].sort());
  });

  it.each(GLOBAL_ENTITY_TYPE_LIST)("%s", (type) => {
    const g = GUARDS[type];
    const src = readFileSync(resolve(ROOT, g.file), "utf8");
    const fromService = new Set(g.constants.flatMap((c) => resolveRoles(src, c)));
    const fromCatalogue = new Set<string>(GLOBAL_ENTITY_TYPES[type].readRoles);
    expect({ type, roles: [...fromCatalogue].sort() }).toEqual({ type, roles: [...fromService].sort() });
    // the route is still there and is guarded by the constant(s) we compared against
    const idx = src.indexOf(g.route);
    expect(idx, `route ${g.route} not found in ${g.file}`).toBeGreaterThan(-1);
    const guard = g.routeGuard ?? g.constants;
    const next = src.indexOf("\n  app.", idx + 1);
    const window = src.slice(idx, next === -1 ? undefined : next); // this route handler only
    const used = guard.find((c) => window.includes(`requireRole(ctx, ${c})`));
    expect(used, `${g.route} is no longer guarded by ${guard.join("/")}`).toBeTruthy();
    // a narrower catalogue must stay inside the route's own guard
    const routeRoles = new Set(resolveRoles(src, used!));
    for (const r of fromCatalogue) expect(routeRoles.has(r), `${type}: catalogue role ${r} is not accepted by ${g.route}`).toBe(true);
  });

  it("resolveRoles handles literals and spreads", () => {
    const s = 'const A = ["x", "y"];\nconst B = [...A, "z"];';
    expect(resolveRoles(s, "B")).toEqual(["x", "y", "z"]);
  });
});
