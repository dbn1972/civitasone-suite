/**
 * UAT onboarding gap: Keycloak 24 drops user attributes the declarative user profile does not
 * declare. The realm export must declare every attribute identity-service stamps, and the
 * deploy-time scripts (apply-user-profile / backfill-tenant-attribute) must be idempotent and
 * must never move a user to a tenant other than the one in its namespaced username.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain ESM script helpers, no type declarations
import { TENANT_ATTRIBUTES, mergeProfile, planUser, withTenantAttributes, tenantFromUsername, maskUsername } from "../../../infra/keycloak/scripts/lib.mjs";

const TENANT = "8dcb509d-5b1e-4c3a-9e0f-2a7d4c6b1f10";
const OTHER = "11111111-0000-0000-0000-000000000001";

describe("realm export declares the tenant attributes", () => {
  it("civitasone-realm.json user profile declares tenantId, tid, identity_user_id, email_addr (admin-edit only)", () => {
    const realm = JSON.parse(readFileSync(new URL("../../../infra/keycloak/civitasone-realm.json", import.meta.url), "utf8"));
    const cfg = realm.components["org.keycloak.userprofile.UserProfileProvider"][0].config["kc.user.profile.config"][0];
    const attrs = JSON.parse(cfg).attributes as Array<{ name: string; permissions: { edit: string[] } }>;
    for (const name of ["tenantId", "tid", "identity_user_id", "email_addr"]) {
      const a = attrs.find((x) => x.name === name);
      expect(a, name).toBeDefined();
      expect(a!.permissions.edit).toEqual(["admin"]);
    }
    expect(attrs.map((a) => a.name)).toEqual(expect.arrayContaining(["username", "email", "firstName", "lastName"]));
  });

  it("identity-service writes only attributes the profile declares", () => {
    const src = readFileSync(new URL("../src/shared/keycloak.ts", import.meta.url), "utf8");
    const m = /attributes: \{ ([^}]+) \}/.exec(src);
    const written = m![1]!.split(",").map((s) => s.split(":")[0]!.trim());
    for (const w of written) expect(TENANT_ATTRIBUTES).toContain(w);
  });
});

describe("apply-user-profile merge", () => {
  const existing = { attributes: [{ name: "username" }, { name: "tenantId", permissions: { view: ["admin"], edit: ["admin"] } }], groups: [{ name: "g" }], unmanagedAttributePolicy: "ENABLED" };

  it("adds only the missing attributes and keeps everything else", () => {
    const { profile, added } = mergeProfile(existing);
    expect(added).toEqual(["tid", "identity_user_id", "email_addr"]);
    expect(profile.attributes.map((a: { name: string }) => a.name)).toEqual(["username", "tenantId", "tid", "identity_user_id", "email_addr"]);
    expect(profile.groups).toEqual(existing.groups);
    expect(profile.unmanagedAttributePolicy).toBe("ENABLED");
    expect(profile.attributes[1]).toBe(existing.attributes[1]);
    expect(mergeProfile(existing).tightened).toEqual([]);
  });

  it("an already-declared tenant attribute that users can view or edit is reported and tightened to admin-only", () => {
    const loose = {
      attributes: [
        { name: "tenantId", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
        { name: "tid", permissions: { view: ["admin"], edit: ["admin", "user"] } },
        { name: "identity_user_id" },
        { name: "email_addr", permissions: { view: ["admin"], edit: ["admin"] } },
        { name: "department", permissions: { view: ["admin", "user"], edit: ["user"] } },
      ],
    };
    const { profile, added, tightened } = mergeProfile(loose);
    expect(added).toEqual([]);
    expect(tightened).toEqual(["tenantId", "tid", "identity_user_id"]);
    const by = (n: string) => profile.attributes.find((a: { name: string }) => a.name === n);
    for (const n of ["tenantId", "tid", "identity_user_id", "email_addr"]) expect(by(n).permissions).toEqual({ view: ["admin"], edit: ["admin"] });
    expect(by("department")).toBe(loose.attributes[4]); // unrelated attributes untouched
    expect(mergeProfile(profile).tightened).toEqual([]); // idempotent
  });

  it("masks usernames for logs: no tenant id, no full email", () => {
    expect(maskUsername(`${TENANT}__dm.nashik@maharashtra.gov.in`)).toBe("d***@maharashtra.gov.in");
  });

  it("is idempotent: a second run adds nothing", () => {
    const once = mergeProfile(existing).profile;
    expect(mergeProfile(once).added).toEqual([]);
  });
});

describe("backfill-tenant-attribute plan", () => {
  const user = (username: string, attributes?: Record<string, string[]>) => ({ id: "kc1", username, ...(attributes ? { attributes } : {}) });

  it("derives the tenant from the namespaced username only", () => {
    expect(tenantFromUsername(`${TENANT.toUpperCase()}__dm.nashik@maharashtra.gov.in`)).toBe(TENANT);
    expect(tenantFromUsername("dev-officer")).toBeNull();
    expect(tenantFromUsername("not-a-uuid__x@y.gov.in")).toBeNull();
  });

  it("updates a namespaced user with no tenant attributes, sets both tenantId and tid, keeps other attributes", () => {
    const u = user(`${TENANT}__dm.nashik@maharashtra.gov.in`, { email_addr: ["dm.nashik@maharashtra.gov.in"] });
    expect(planUser(u)).toEqual({ action: "update", tenant: TENANT });
    expect(withTenantAttributes(u, TENANT).attributes).toEqual({ email_addr: ["dm.nashik@maharashtra.gov.in"], tenantId: [TENANT], tid: [TENANT] });
  });

  it("updates a user that has tenantId (tenant A style) but no tid; idempotent once both are set", () => {
    const u = user(`${TENANT}__a@b.gov.in`, { tenantId: [TENANT] });
    expect(planUser(u).action).toBe("update");
    expect(planUser(user(`${TENANT}__a@b.gov.in`, { tenantId: [TENANT], tid: [TENANT] })).action).toBe("ok");
  });

  it("never touches a user whose attributes name a different tenant than the username, nor non-namespaced users", () => {
    expect(planUser(user(`${TENANT}__a@b.gov.in`, { tenantId: [OTHER] })).action).toBe("conflict");
    expect(planUser(user(`${TENANT}__a@b.gov.in`, { tid: [OTHER] })).action).toBe("conflict");
    expect(planUser(user("dev-superadmin", { tenantId: [OTHER] })).action).toBe("skip");
  });
});
