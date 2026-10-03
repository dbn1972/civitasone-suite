import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GRIEVANCE_STATUSES, GRIEVANCE_CATEGORIES, GRIEVANCE_DISPOSITIONS, GRIEVANCE_ROLES, isOpenStatus } from "./grievanceModel";

// The web app cannot import the service package, so read its source text and
// compare the literal lists: a status/category added on one side only fails here.
const SERVICE = join(process.cwd(), "../../services/hrms-service/src/modules/grievance");

function listFrom(file: string, name: string): string[] {
  const src = readFileSync(join(SERVICE, file), "utf8");
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(src);
  if (!m) throw new Error(`${name} not found in ${file}`);
  return [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
}

describe("grievance model mirrors the hrms-service domain", () => {
  it("statuses", () => expect([...GRIEVANCE_STATUSES]).toEqual(listFrom("domain.ts", "GRIEVANCE_STATUSES")));
  it("categories", () => expect([...GRIEVANCE_CATEGORIES]).toEqual(listFrom("domain.ts", "GRIEVANCE_CATEGORIES")));
  it("dispositions", () => expect([...GRIEVANCE_DISPOSITIONS]).toEqual(listFrom("domain.ts", "GRIEVANCE_DISPOSITIONS")));
  it("roles", () => {
    const src = readFileSync(join(SERVICE, "routes.ts"), "utf8");
    const m = /export const GRIEVANCE_ROLES = \[([^\]]*)\]/.exec(src)!;
    expect([...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1])).toEqual(GRIEVANCE_ROLES);
  });
  it("only disposed is closed", () => {
    expect(GRIEVANCE_STATUSES.filter(isOpenStatus)).toEqual(["registered", "under_inquiry"]);
  });
});
