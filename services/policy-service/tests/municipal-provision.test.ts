/**
 * Municipal role tenant provisioning from catalog.
 */
import { describe, it, expect } from "vitest";
import { buildMunicipalRoleSeedSql } from "../src/modules/roles/municipal-provision.js";
import { listMunicipalRoleNames, MUNICIPAL_SERVICE_CATALOG } from "../src/modules/roles/municipal-catalog.js";

const TENANT = "aaaaaaaa-cccc-4000-8000-000000000099";
const ACTOR = "00000000-cccc-4000-8000-000000000002";

describe("municipal-provision", () => {
  it("catalog covers 17 services", () => {
    expect(MUNICIPAL_SERVICE_CATALOG).toHaveLength(17);
    expect(listMunicipalRoleNames().length).toBeGreaterThanOrEqual(50);
  });

  it("buildMunicipalRoleSeedSql emits INSERT for all catalog roles", () => {
    const sql = buildMunicipalRoleSeedSql(TENANT, ACTOR);
    const roleCount = listMunicipalRoleNames().length;
    expect(sql).toContain("INSERT INTO roles.roles");
    expect(sql).toContain(`(${roleCount} stubs)`);
    expect(sql).toContain("shop_user");
    expect(sql).toContain("market_admin");
    expect(sql).toContain("fire_inspector");
    expect(sql).toContain("ON CONFLICT (tenant_id, name) DO NOTHING");
    expect(sql.match(/'\w+_\w+'/g)?.length).toBeGreaterThanOrEqual(roleCount);
  });
});
