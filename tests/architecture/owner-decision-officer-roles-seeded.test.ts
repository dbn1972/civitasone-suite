import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// UAT d-tenant owner decisions #19-#23 reserve actions to officer roles. A role
// that exists only as a string in code can never be assigned to a user, so each
// one must be seeded in the Keycloak realm.
const realm = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../infra/keycloak/civitasone-realm.json", import.meta.url)), "utf8"),
) as { roles: { realm: Array<{ name: string }> } };
const seeded = new Set(realm.roles.realm.map((r) => r.name));

describe("owner-decision officer roles are seeded in the Keycloak realm", () => {
  it.each(["consent_officer", "audit_officer", "security_admin", "migration_admin", "bid_opening_committee"])("%s", (role) => {
    expect(seeded.has(role)).toBe(true);
  });
  // Owner decision H1: procurement-service reveals bidder identities before
  // opening only to this exact role string, so the realm must define that string.
  it("realm defines the role procurement-service checks (BID_OPENING_COMMITTEE_ROLES)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../../services/procurement-service/src/modules/tender/domain.ts", import.meta.url)),
      "utf8",
    );
    const m = /BID_OPENING_COMMITTEE_ROLES\s*=\s*\[([^\]]+)\]/.exec(src);
    expect(m).not.toBeNull();
    const roles = [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    expect(roles).toEqual(["bid_opening_committee"]);
    for (const r of roles) expect(seeded.has(r)).toBe(true);
  });
  it("has no duplicate realm role names", () => {
    expect(seeded.size).toBe(realm.roles.realm.length);
  });
});
