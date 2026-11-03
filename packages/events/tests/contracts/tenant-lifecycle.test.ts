/**
 * UAT bundle 15 (F133): the tenant.tenant.created contract. v1.0 events (`{ tenantId, plan }`, the shape
 * tenant-service sent before the fix and still present in queues) must keep validating; v1.1 adds the directory
 * fields admin-service registers.
 */
import { describe, it, expect } from "vitest";
import {
  tenantTenantCreated, missingTenantDirectoryFields, TENANT_DIRECTORY_FIELDS,
} from "../../src/contracts/index.js";

const T = "353c0e2c-aab9-4a64-8e05-9503f6973020";

describe("tenant.tenant.created contract (F133)", () => {
  it("is owned by tenant-service and consumed by admin-service", () => {
    expect(tenantTenantCreated.owner).toBe("tenant-service");
    expect(tenantTenantCreated.kind).toBe("event");
    expect(tenantTenantCreated.consumers).toContain("admin-service");
  });

  it("still accepts a v1.0 event (tenantId + plan only)", () => {
    expect(tenantTenantCreated.validate({ tenantId: T, plan: "govt" })).toEqual({ ok: true });
  });

  it("accepts a v1.1 event carrying the directory fields", () => {
    expect(tenantTenantCreated.validate({
      tenantId: T, id: T, plan: "govt", edition: "govt", name: "UAT Office", domain: "uat.example.in",
      status: "draft", region: "ap-south-1", residency: "IN",
    })).toEqual({ ok: true });
  });

  it("rejects an event whose tenantId is not a uuid", () => {
    expect(tenantTenantCreated.validate({ tenantId: "not-a-uuid", plan: "govt" }).ok).toBe(false);
  });

  it("lists what a v1.0 event lacks; plan stands in for edition", () => {
    expect(missingTenantDirectoryFields({ tenantId: T, plan: "govt" })).toEqual(["name", "domain", "region", "residency"]);
    expect(missingTenantDirectoryFields({ tenantId: T })).toEqual([...TENANT_DIRECTORY_FIELDS]);
    expect(missingTenantDirectoryFields({
      tenantId: T, name: "UAT Office", domain: "uat.example.in", edition: "govt", region: "ap-south-1", residency: "IN",
    })).toEqual([]);
    expect(missingTenantDirectoryFields({ tenantId: T, name: "  ", domain: "d", plan: "psu", region: "r", residency: "IN" })).toEqual(["name"]);
  });
});
