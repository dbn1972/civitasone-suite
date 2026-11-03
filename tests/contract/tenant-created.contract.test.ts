/**
 * F133 (UAT bundle 15) -- producer/consumer contract for tenant.tenant.created.
 *
 * tenant-service emitted `{ tenantId, plan }`; admin-service registered the tenant from `id/name/domain/edition/
 * region/residency`, fields no producer sent, so admin never registered a new tenant (/admin/tenants/[id] 404).
 * Neither service suite could see it. This feeds the payload tenant-service really builds to the reader
 * admin-service really runs, and checks both against the shared contract (@civitasone/events/contracts): a rename on
 * either side fails here.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenantTenantCreated } from "../../packages/events/src/contracts/index.js";
import { tenantCreatedEventPayload } from "../../services/tenant-service/src/modules/tenant/events.js";
import { resolveTenantCreated } from "../../services/admin-service/src/modules/tenants/tenant-created.js";

const ROOT = process.cwd();
const T = "353c0e2c-aab9-4a64-8e05-9503f6973020";
const VIEW = {
  id: T, tenantId: T, name: "UAT Office", domain: "uat-office.example.in", edition: "govt" as const,
  status: "draft" as const, region: "ap-south-1", residency: "IN", settings: {}, version: 1,
};

describe("tenant.tenant.created contract (tenant-service -> admin-service)", () => {
  it("the producer payload validates against the shared contract", () => {
    expect(tenantTenantCreated.validate(tenantCreatedEventPayload(VIEW))).toEqual({ ok: true });
  });

  it("admin-service registers the tenant from the producer payload alone, with no fallback fetch", async () => {
    const fetchTenant = vi.fn();
    const row = await resolveTenantCreated(tenantCreatedEventPayload(VIEW), fetchTenant);
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(row).toMatchObject({ id: T, name: "UAT Office", domain: "uat-office.example.in", region: "ap-south-1", residency: "IN" });
  });

  it("a v1.0 event (the pre-fix shape) is still accepted by the contract and completed by the consumer", async () => {
    const legacy = { tenantId: T, plan: "govt" };
    expect(tenantTenantCreated.validate(legacy)).toEqual({ ok: true });
    const row = await resolveTenantCreated(legacy, vi.fn().mockResolvedValue(VIEW));
    expect(row).toMatchObject({ id: T, name: "UAT Office", edition: "govt_dept" });
  });

  it("tenant-service emits the event through the builder, and admin-service subscribes through the resolver", () => {
    const producer = readFileSync(join(ROOT, "services/tenant-service/src/modules/tenant/consumer.ts"), "utf8");
    expect(producer).toMatch(/EVENTS\.tenantCreated, tenantCreatedEventPayload\(/);
    const consumer = readFileSync(join(ROOT, "services/admin-service/src/modules/tenants/consumer.ts"), "utf8");
    expect(consumer).toMatch(/"tenant\.tenant\.created"/);
    expect(consumer).toMatch(/resolveTenantCreated\(/);
  });
});
