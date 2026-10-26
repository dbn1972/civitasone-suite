/**
 * GAP-LEGAL-OPINIONS-NEW-03 (owner decision #13): the opinion addressee is an internal
 * department chosen from the org hierarchy (default), or an "external party" with a
 * free-text name. An opinion can no longer be routed to nobody.
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
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { registerOpinionConsumers } from "../src/modules/opinions/consumer.js";
import { setOrgClient, OrgServiceError } from "../src/shared/org-client.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { useFakeOrg, TEST_DEPT_ID, TEST_DEPT_NAME } from "./helpers/org-fake.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000d1501";
const ACTOR = "00000000-aaaa-4000-8000-0000000d1501";
const LEGACY = "33333333-cccc-4000-8000-0000000d1501";
const auth = (roles: string[] = ["legal_officer"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });
const drain = () => new Promise<void>((r) => setTimeout(r, 400));

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalOpinions).where(eq(legalOpinions.tenantId, TENANT));
  }));
  for (const r of ["opinion", "opinions"]) await cache.invalidateResource(TENANT, r);
}

const base = { subject: "Service rules query", question: "Is the proposal within the rules?" };
const seek = (app: FastifyInstance, extra: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/legal/opinions", headers: auth(), payload: { ...base, ...extra } });

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerOpinionConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => { await wipe(); useFakeOrg(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

type Addressee = { type: string; departmentId?: string; name?: string } | null;
const listItems = async () => ((await app.inject({ method: "GET", url: "/v1/legal/opinions", headers: auth() })).json() as { items: Array<{ id: string; addressee: Addressee }> }).items;

describe("opinion addressee (decision #13)", () => {
  it("is required: an opinion cannot be sought without an addressee", async () => {
    expect((await seek(app, {})).statusCode).toBe(400);
  });

  it("an internal department addressee is validated against the org hierarchy, stored and shown with its name", async () => {
    const r = await seek(app, { addressee: { type: "department", departmentId: TEST_DEPT_ID } });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    await drain();
    const row = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalOpinions).where(eq(legalOpinions.id, id)))))[0]!;
    expect(row.addresseeType).toBe("department");
    expect(row.addresseeDepartmentId).toBe(TEST_DEPT_ID);
    expect(row.addresseeName).toBeNull();
    const detail = (await app.inject({ method: "GET", url: `/v1/legal/opinions/${id}`, headers: auth() })).json() as { addressee: Addressee };
    expect(detail.addressee).toEqual({ type: "department", departmentId: TEST_DEPT_ID, name: TEST_DEPT_NAME });
    expect((await listItems()).find((i) => i.id === id)!.addressee).toEqual({ type: "department", departmentId: TEST_DEPT_ID, name: TEST_DEPT_NAME });
  });

  it("an external party addressee carries a free-text name and needs no department lookup", async () => {
    setOrgClient({ async listDepartments() { throw new OrgServiceError("unavailable", "down"); } });
    const r = await seek(app, { addressee: { type: "external", name: "M/s Acme Infra Ltd" } });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    await drain();
    useFakeOrg();
    const detail = (await app.inject({ method: "GET", url: `/v1/legal/opinions/${id}`, headers: auth() })).json() as { addressee: Addressee };
    expect(detail.addressee).toEqual({ type: "external", name: "M/s Acme Infra Ltd" });
  });

  it("rejects a malformed addressee (400), an unknown department (422) and fails closed with a retryable 503", async () => {
    expect((await seek(app, { addressee: { type: "external", name: "  " } })).statusCode).toBe(400);
    expect((await seek(app, { addressee: { type: "department" } })).statusCode).toBe(400);
    expect((await seek(app, { addressee: { type: "department", departmentId: "not-a-uuid" } })).statusCode).toBe(400);
    expect((await seek(app, { addressee: { type: "nobody" } })).statusCode).toBe(400);
    const unknown = await seek(app, { addressee: { type: "department", departmentId: "99999999-aaaa-4000-8000-0000000d15ff" } });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().code).toBe("UNKNOWN_DEPARTMENT");
    setOrgClient({ async listDepartments() { throw new OrgServiceError("unavailable", "ECONNREFUSED hrms"); } });
    const down = await seek(app, { addressee: { type: "department", departmentId: TEST_DEPT_ID } });
    expect(down.statusCode).toBe(503);
    expect(JSON.stringify(down.json())).not.toContain("ECONNREFUSED");
    expect(down.json().retryable).toBe(true);
  });

  it("legacy opinions without an addressee read back addressee: null (list and detail agree)", async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(legalOpinions).values({
      id: LEGACY, tenantId: TENANT, opinionNo: "OPN/2026/D1501", subject: "old", question: "old?", status: "sought", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    await cache.invalidateResource(TENANT, "opinions");
    const detail = (await app.inject({ method: "GET", url: `/v1/legal/opinions/${LEGACY}`, headers: auth() })).json() as { addressee: Addressee };
    expect(detail.addressee).toBeNull();
    expect((await listItems()).find((i) => i.id === LEGACY)!.addressee).toBeNull();
  });
});
