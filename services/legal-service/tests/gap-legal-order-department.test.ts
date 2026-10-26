/**
 * GAP-LEGAL-COURT-ORDERS-NEW-04 (owner decision #11): an order's owning department (deptRef)
 * stores the department ID from the org hierarchy; the name is resolved for display.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOrders } from "../src/modules/hearings/schema.js";
import { registerHearingConsumers } from "../src/modules/hearings/consumer.js";
import { setOrgClient, OrgServiceError } from "../src/shared/org-client.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { useFakeOrg, TEST_DEPT_ID, TEST_DEPT_NAME } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000d1301";
const ACTOR = "00000000-aaaa-4000-8000-0000000d1301";
const CASE_ID = "22222222-bbbb-4000-8000-0000000d1301";
const LEGACY_ORDER = "33333333-cccc-4000-8000-0000000d1301";
const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
const auth = (roles: string[] = ["legal_officer"]) => ({ authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT });
const drain = () => new Promise<void>((r) => setTimeout(r, 400));

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  }));
  for (const r of ["case", "court_orders"]) await cache.invalidateResource(TENANT, r);
}

const order = (over: Record<string, unknown> = {}) => ({ orderType: "judgment", summary: "Directed to file reply", orderDate: "2026-04-01", complianceRequired: true, complianceDeadline: "2026-05-01", ...over });
const post = (app: FastifyInstance, payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/v1/legal/cases/${CASE_ID}/orders`, headers: auth(), payload });
const list = async (app: FastifyInstance) => (await app.inject({ method: "GET", url: "/v1/legal/court-orders?limit=50", headers: auth() })).json() as { items: Array<{ id: string; department?: string; summary: string }> };

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerHearingConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => {
  await wipe();
  useFakeOrg();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(legalCases).values({
    id: CASE_ID, tenantId: TENANT, caseNo: "WP/1301/2026", title: "Dept order case", court: "High Court of Delhi", createdBy: ACTOR, updatedBy: ACTOR,
  })));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("order owning department (decision #11)", () => {
  it("stores the department id from the org hierarchy and the list shows the resolved name", async () => {
    const res = await post(app, order({ deptRef: TEST_DEPT_ID }));
    expect(res.statusCode).toBe(202);
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalOrders).where(eq(legalOrders.caseId, CASE_ID))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deptRef).toBe(TEST_DEPT_ID);
    const items = (await list(app)).items;
    expect(items.find((i) => i.id === rows[0]!.id)!.department).toBe(TEST_DEPT_NAME);
  });

  it("rejects free-text (not an id) and an unknown department id; the department stays optional", async () => {
    const free = await post(app, order({ deptRef: "Revenue dept" }));
    expect(free.statusCode).toBe(400);
    const unknown = await post(app, order({ deptRef: "99999999-aaaa-4000-8000-0000000d13ff" }));
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().code).toBe("UNKNOWN_DEPARTMENT");
    expect((await post(app, order())).statusCode).toBe(202);
  });

  it("fails closed (retryable 503, no raw error) when the org service is unavailable", async () => {
    setOrgClient({ async listDepartments() { throw new OrgServiceError("unavailable", "ECONNREFUSED hrms-internal"); } });
    const res = await post(app, order({ deptRef: TEST_DEPT_ID }));
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.json())).not.toContain("ECONNREFUSED");
    expect(res.json().retryable).toBe(true);
  });

  it("legacy free-text rows still display as typed; an unresolvable id is never shown as a raw uuid", async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(legalOrders).values([
      { id: LEGACY_ORDER, tenantId: TENANT, caseId: CASE_ID, orderType: "judgment", summary: "legacy", orderDate: "2026-01-01", deptRef: "Old Revenue Dept", createdBy: ACTOR, updatedBy: ACTOR },
      { id: "33333333-cccc-4000-8000-0000000d1302", tenantId: TENANT, caseId: CASE_ID, orderType: "judgment", summary: "orphan", orderDate: "2026-01-02", deptRef: "99999999-aaaa-4000-8000-0000000d13aa", createdBy: ACTOR, updatedBy: ACTOR },
    ])));
    await cache.invalidateResource(TENANT, "court_orders");
    const items = (await list(app)).items;
    expect(items.find((i) => i.summary === "legacy")!.department).toBe("Old Revenue Dept");
    expect(items.find((i) => i.summary === "orphan")!.department).toBeUndefined();
  });
});
