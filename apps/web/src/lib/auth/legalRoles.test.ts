import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LEGAL_ROLES } from "./navRoles";

/**
 * legal-service is the authority. The web Legal menu/layout guard must be exactly the union of
 * the roles any legal-service module route accepts, so the menu is only offered to roles whose
 * data calls will not 403 (GAP-LEGAL-ROLE-DRIFT). Read the server source instead of a literal.
 */
const MODULES_DIR = resolve(__dirname, "../../../../../services/legal-service/src/modules");

function serverRoleUnion(): string[] {
  const roles = new Set<string>();
  for (const mod of ["cases", "opinions", "hearings", "dashboard", "advocates", "attachments", "reminders"]) {
    const file = resolve(MODULES_DIR, mod, "routes.ts");
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^const (?:LEGAL_ROLES|ADMIN_ROLES|ROLES|READER_ROLES)\s*=\s*\[([^\]]*)\]/gm)) {
      for (const r of m[1]!.matchAll(/"([a-z_]+)"/g)) roles.add(r[1]!);
    }
  }
  return [...roles];
}

describe("LEGAL_ROLES vs legal-service", () => {
  it("could read the legal-service role lists", () => {
    expect(readdirSync(MODULES_DIR).length).toBeGreaterThan(0);
    expect(serverRoleUnion().length).toBeGreaterThan(0);
  });
  it("equals the union of roles legal-service routes accept", () => {
    expect([...LEGAL_ROLES].sort()).toEqual(serverRoleUnion().sort());
  });
  it("does not offer Legal to platform_admin (every legal-service route 403s it)", () => {
    expect(LEGAL_ROLES).not.toContain("platform_admin");
  });
});
