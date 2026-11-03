/**
 * UAT bundle 15 (F133): tenant.tenant.created carried only `{ tenantId, plan }`, so admin-service (which registers
 * the tenant from this event) could not create its row and /admin/tenants/[id] was 404 for every new tenant. The
 * event now carries the directory fields, built in one place and checked against the shared contract.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenantTenantCreated, missingTenantDirectoryFields } from "@civitasone/events/contracts";
import { tenantCreatedEventPayload } from "../src/modules/tenant/events.js";

const T = "353c0e2c-aab9-4a64-8e05-9503f6973020";
const VIEW = {
  id: T, tenantId: T, name: "UAT Office", domain: "uat-office.example.in", edition: "govt" as const,
  status: "draft" as const, region: "ap-south-1", residency: "IN", settings: { theme: "x" }, version: 1,
};

describe("tenant.tenant.created payload (F133)", () => {
  it("carries every directory field admin-service registers, and validates against the shared contract", () => {
    const p = tenantCreatedEventPayload(VIEW);
    expect(p).toMatchObject({
      tenantId: T, id: T, name: "UAT Office", domain: "uat-office.example.in", edition: "govt",
      status: "draft", region: "ap-south-1", residency: "IN",
    });
    expect(missingTenantDirectoryFields(p)).toEqual([]);
    expect(tenantTenantCreated.validate(p)).toEqual({ ok: true });
  });

  it("keeps the v1.0 `plan` field so an older reader still works", () => {
    expect(tenantCreatedEventPayload(VIEW).plan).toBe("govt");
  });

  it("does not put tenant settings on the event", () => {
    expect(tenantCreatedEventPayload(VIEW)).not.toHaveProperty("settings");
  });

  it("the create consumer emits the event through this builder", () => {
    const src = readFileSync(join(__dirname, "../src/modules/tenant/consumer.ts"), "utf8");
    expect(src).toMatch(/emit\(tx, msg, EVENTS\.tenantCreated, tenantCreatedEventPayload\(/);
  });
});
