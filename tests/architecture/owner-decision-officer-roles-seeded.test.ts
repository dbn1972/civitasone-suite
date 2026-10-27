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
  it.each(["consent_officer", "audit_officer", "security_admin", "migration_admin"])("%s", (role) => {
    expect(seeded.has(role)).toBe(true);
  });
  it("has no duplicate realm role names", () => {
    expect(seeded.size).toBe(realm.roles.realm.length);
  });
});
