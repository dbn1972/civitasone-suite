/**
 * UAT b24: DDO master write path. Before this, no tenant could create a DDO (GET only; the ddo_sync consumer had no
 * producer), so every finance.bill.create dead-lettered UNKNOWN_DDO after a 202. Real Postgres, run as the
 * non-superuser app role so row-level security is in force; seeds are written under the tenant context.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { sqlClient, scopedRead } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { buildApp } from "../src/app.js";
import { registerTenantOnboardConsumers } from "../src/modules/tenant-onboard/consumer.js";
import * as mastersRepo from "../src/modules/masters/repo.js";
import { assertBillDdoConfigured } from "../src/modules/masters/ddo-commands.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "b24d0000-0000-4000-8000-00000000a001";
const hdr = (tenant: string, role: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: [role], sid: `s-${tenant}` }, JWT_SECRET)}`,
});

afterAll(async () => { await sqlClient.end(); });

describe("POST/PATCH /v1/finance/ddo", () => {
  it("a finance_admin creates a DDO (201), it shows in GET, and a duplicate code is a 409", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"),
      payload: { ddoCode: "smc000101", name: "Drawing and Disbursing Officer, Solapur Municipal Corporation" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ddoCode: "SMC000101", isActive: true });
    const list = await app.inject({ method: "GET", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_officer") });
    expect(list.json().data.map((d: { ddoCode: string }) => d.ddoCode)).toEqual(["SMC000101"]);
    const dup = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"),
      payload: { ddoCode: "SMC000101", name: "Duplicate" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DDO_EXISTS");
    // tenant isolation: another tenant sees nothing
    const other = await app.inject({ method: "GET", url: "/v1/finance/ddo", headers: hdr(randomUUID(), "finance_admin") });
    expect(other.json().data).toEqual([]);
  });

  it("tenant_admin may create; a finance_officer may not; a malformed code is a 422", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    const ok = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "tenant_admin"),
      payload: { ddoCode: "DIC0A0042", name: "DDO, District Informatics Centre" } });
    expect(ok.statusCode).toBe(201);
    const denied = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_officer"),
      payload: { ddoCode: "DIC0A0043", name: "Not allowed" } });
    expect(denied.statusCode).toBe(403);
    const bad = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"),
      payload: { ddoCode: "AB-1", name: "Bad code" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("INVALID_DDO_CODE");
  });

  it("PATCH renames/deactivates, and the tenant default DDO cannot be deactivated", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    const mk = await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"),
      payload: { ddoCode: "SMC000102", name: "DDO Solapur", makeDefault: true, agencyCode: "MHSMC001" } });
    expect(mk.statusCode).toBe(201);
    const id = mk.json().id as string;
    const ren = await app.inject({ method: "PATCH", url: `/v1/finance/ddo/${id}`, headers: hdr(tenant, "finance_admin"), payload: { name: "DDO, Solapur Municipal Corporation" } });
    expect(ren.statusCode).toBe(200);
    expect(ren.json().name).toBe("DDO, Solapur Municipal Corporation");
    const deact = await app.inject({ method: "PATCH", url: `/v1/finance/ddo/${id}`, headers: hdr(tenant, "finance_admin"), payload: { isActive: false } });
    expect(deact.statusCode).toBe(409);
    expect(deact.json().code).toBe("DDO_IS_DEFAULT");
    const cfg = await app.inject({ method: "GET", url: "/v1/finance/pfms/config", headers: hdr(tenant, "finance_admin") });
    expect(cfg.json()).toMatchObject({ defaultDdo: "SMC000102", agencyCode: "MHSMC001" });
  });

  it("PUT /pfms/config sets the default to an existing DDO only; a first config needs an agency code", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    const none = await app.inject({ method: "PUT", url: "/v1/finance/pfms/config", headers: hdr(tenant, "tenant_admin"), payload: { defaultDdo: "SMC000103" } });
    expect(none.statusCode).toBe(422);
    expect(none.json().code).toBe("DDO_NOT_CONFIGURED");
    await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"), payload: { ddoCode: "SMC000103", name: "DDO Solapur" } });
    const noAgency = await app.inject({ method: "PUT", url: "/v1/finance/pfms/config", headers: hdr(tenant, "tenant_admin"), payload: { defaultDdo: "SMC000103" } });
    expect(noAgency.statusCode).toBe(422);
    expect(noAgency.json().code).toBe("AGENCY_CODE_REQUIRED");
    const ok = await app.inject({ method: "PUT", url: "/v1/finance/pfms/config", headers: hdr(tenant, "tenant_admin"), payload: { defaultDdo: "smc000103", agencyCode: "MHSMC001" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ defaultDdo: "SMC000103" });
  });
});

describe("bill route DDO pre-check", () => {
  it("POST /v1/finance/bills with an unconfigured DDO is a 422 DDO_NOT_CONFIGURED, not a 202 that dead-letters", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    const headId = randomUUID();
    await scoped(tenant, (tx) => tx.insert(financeHeads).values({
      id: headId, tenantId: tenant, code: "AP-EXP", name: "Office expenses", level: 2, hoaCode: "207101010101010101", createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const bill = (ddoCode: string) => ({ billNo: `SMC/AP/2026-27/${ddoCode}`, vendorId: randomUUID(), headId, ddoCode, grossMinor: 1250000, deductions: [] });
    const res = await app.inject({ method: "POST", url: "/v1/finance/bills", headers: hdr(tenant, "finance_officer"), payload: bill("SMC000199") });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DDO_NOT_CONFIGURED");
    expect(res.json().message).toMatch(/set up/i);
    // once the DDO exists the same bill is accepted
    await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"), payload: { ddoCode: "SMC000199", name: "DDO Solapur" } });
    const ok = await app.inject({ method: "POST", url: "/v1/finance/bills", headers: hdr(tenant, "finance_officer"), payload: bill("SMC000199") });
    expect(ok.statusCode).toBe(202);
  });

  it("resolves payload, then tenant config default, then DDO000001; passes only for an active DDO of the tenant", async () => {
    const tenant = randomUUID();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/v1/finance/ddo", headers: hdr(tenant, "finance_admin"),
      payload: { ddoCode: "SMC000104", name: "DDO Solapur", makeDefault: true, agencyCode: "MHSMC001" } });
    await runWithTenant(tenant, async () => {
      expect(await assertBillDdoConfigured(tenant, "smc000104")).toBe("SMC000104");
      expect(await assertBillDdoConfigured(tenant, undefined)).toBe("SMC000104"); // tenant config default
      await expect(assertBillDdoConfigured(tenant, "SMC000999")).rejects.toMatchObject({ status: 422, code: "DDO_NOT_CONFIGURED" });
      expect(await scopedRead((tx) => mastersRepo.ddoExists(tenant, "DDO000001", tx as never))).toBe(false);
    });
  });
});

describe("tenant onboarding seeds a default DDO", () => {
  it("tenant.tenant.onboarded creates DDO000001 for the new tenant, idempotently", async () => {
    const tenant = randomUUID();
    const handlers: Array<(m: unknown) => Promise<void>> = [];
    registerTenantOnboardConsumers({ subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { handlers.push(h); } } as never);
    const msg = { messageId: randomUUID(), type: "tenant.tenant.onboarded", tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: tenant, adminEmail: "accounts@smc.gov.in", adminName: "Accounts Officer", edition: "govt_dept" } };
    // The shared CGA major-head seed in the same handler has a separate, pre-existing CHECK failure; the DDO seed
    // runs in its own transaction before it, like the GL heads.
    const run = () => runWithTenant(tenant, () => handlers[0]!(msg)).catch((e: unknown) => { if (!/finance_major_heads_account_type_check/.test(String(e))) throw e; });
    await run();
    await run();
    await runWithTenant(tenant, async () => {
      const rows = await mastersRepo.listDdo(tenant);
      expect(rows.map((r) => r.ddoCode)).toEqual(["DDO000001"]);
      expect(await scopedRead((tx) => mastersRepo.ddoExists(tenant, "DDO000001", tx as never))).toBe(true);
    });
  });
});
