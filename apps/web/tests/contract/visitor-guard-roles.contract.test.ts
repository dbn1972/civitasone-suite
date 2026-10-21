import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VISITOR_GUARD_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-VISITOR-HOME-02 (owner decision): the plain `employee` role has no gate
 * access. The web guard-console role list must stay identical to what the
 * visitor-service check-in routes admit, so this pins the web constant to the
 * backend source (the web cannot import the service module).
 */
const routesSrc = readFileSync(
  resolve(__dirname, "../../../../services/visitor-service/src/modules/check-in/routes.ts"),
  "utf8",
);
function backendRoles(name: string): string[] {
  const m = routesSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${name} not found in check-in/routes.ts`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

describe("visitor guard console roles vs visitor-service check-in routes", () => {
  const gate = backendRoles("GATE_ROLES");
  const write = backendRoles("WRITE_ROLES");
  const active = backendRoles("ACTIVE_ROLES");

  it("employee is not a gate (verify/check-in/check-out/gate-sync) role on the backend", () => {
    expect(gate).not.toContain("employee");
    expect(write).not.toContain("employee");
  });

  it("employee is not offered the guard console on the web", () => {
    expect(VISITOR_GUARD_ROLES).not.toContain("employee");
  });

  it("web guard roles == backend roster-read roles minus employee (== gate roles + protocol_officer)", () => {
    expect([...VISITOR_GUARD_ROLES].sort()).toEqual(active.filter((r) => r !== "employee").sort());
    expect([...VISITOR_GUARD_ROLES].sort()).toEqual([...new Set([...gate, ...write, "protocol_officer"])].sort());
  });
});
