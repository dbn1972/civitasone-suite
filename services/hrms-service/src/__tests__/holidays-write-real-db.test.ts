/**
 * GAP-HR-HOLIDAYS-06 -- holiday create/delete through the F3 queue, real DB, no mocks.
 *
 * DELETE /v1/hrms/holidays/:id used to publish a fresh randomUUID() as the
 * queued op id; the consumer prefers the op id over params.id, so it deleted a
 * random id and removed nothing while the route still answered 204. The same
 * mix-up made POST return an id that was not the id the holiday was inserted
 * with. This suite proves the real holiday is created / removed, audited, and
 * that a delete cannot reach another tenant's row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_holidays_Consumers } from "../modules/holidays/f3-consumer.js";

registerF3_holidays_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "facade00-a04c-4000-8000-000000000041";
const OTHER_TENANT = "facade00-a04c-4000-8000-000000000042";
const SEED_ACTOR = randomUUID();
const tok = (roles: string[], tid = TENANT) => signToken({ sub: randomUUID(), tid, roles, sid: "sess-holidays-write" }, SECRET);
const hr = { authorization: `Bearer ${tok(["hr_admin"])}` };
const mgr = { authorization: `Bearer ${tok(["manager"])}` };
const emp = { authorization: `Bearer ${tok(["employee"])}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, (tx) => tx`DELETE FROM leave.hrms_holidays WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t} AND topic = 'audit.event.record'`);
  }
}
async function seed(tenant: string, name: string, date: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tenant, (tx) => tx`
    INSERT INTO leave.hrms_holidays (id, tenant_id, name, date, type, applicable_to, created_by)
    VALUES (${id}, ${tenant}, ${name}, ${date}, 'gazetted', 'all', ${SEED_ACTOR})`);
  return id;
}
const exists = async (tenant: string, id: string): Promise<boolean> =>
  (await asTenant(tenant, (tx) => tx`SELECT 1 FROM leave.hrms_holidays WHERE id = ${id}`)).length === 1;
async function auditPayloads(action: string): Promise<Array<{ resourceId: string; resourceType: string; metadata: Record<string, unknown> }>> {
  const rows = await asTenant(TENANT, (tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' ORDER BY created_at`);
  return rows
    .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload as string) : r.payload) as { action: string; resourceId: string; resourceType: string; metadata: Record<string, unknown> })
    .filter((p) => p.action === action);
}

beforeAll(async () => { await cleanup(); app = await buildApp(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const del = (headers: Record<string, string>, id: string) => app.inject({ method: "DELETE", url: `/v1/hrms/holidays/${id}`, headers });
const post = (headers: Record<string, string>, payload: unknown) => app.inject({ method: "POST", url: "/v1/hrms/holidays", headers, payload: payload as object });

describe("DELETE /v1/hrms/holidays/:id (GAP-HR-HOLIDAYS-06)", () => {
  it("an HR admin's delete really removes THAT holiday (204, then gone) and is audited", async () => {
    const target = await seed(TENANT, "Diwali", "2027-11-08");
    const bystander = await seed(TENANT, "Holi", "2027-03-22");

    const r = await del(hr, target);
    expect(r.statusCode).toBe(204);
    await drain();

    expect(await exists(TENANT, target)).toBe(false);
    expect(await exists(TENANT, bystander)).toBe(true); // nothing else is touched

    const audits = await auditPayloads("delete");
    const mine = audits.find((a) => a.resourceId === target);
    expect(mine).toBeDefined();
    expect(mine!.resourceType).toBe("holiday");
    expect(mine!.metadata).toMatchObject({ name: "Diwali", date: "2027-11-08", type: "gazetted" });
  });

  it("refuses manager and employee (403) and deletes nothing", async () => {
    const id = await seed(TENANT, "Republic Day", "2027-01-26");
    expect((await del(mgr, id)).statusCode).toBe(403);
    expect((await del(emp, id)).statusCode).toBe(403);
    await drain();
    expect(await exists(TENANT, id)).toBe(true);
  });

  it("an unknown id is 404, not a silent 204", async () => {
    const r = await del(hr, randomUUID());
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
  });

  it("is tenant-scoped: another tenant's HR cannot delete this tenant's holiday (404) and the row survives", async () => {
    const id = await seed(TENANT, "Independence Day", "2027-08-15");
    const other = { authorization: `Bearer ${tok(["hr_admin"], OTHER_TENANT)}` };
    expect((await del(other, id)).statusCode).toBe(404);
    await drain();
    expect(await exists(TENANT, id)).toBe(true);
  });
});

describe("POST /v1/hrms/holidays (GAP-HR-HOLIDAYS-06 sibling: the returned id is the real id)", () => {
  it("202 returns the id the holiday is actually inserted with, and the create is audited", async () => {
    const r = await post(hr, { name: "Gandhi Jayanti", date: "2027-10-02", type: "gazetted", applicableTo: "all" });
    expect(r.statusCode).toBe(202);
    const { id } = r.json() as { id: string };
    await drain();

    const rows = await asTenant(TENANT, (tx) => tx`SELECT name, date::text AS date, type FROM leave.hrms_holidays WHERE id = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Gandhi Jayanti", date: "2027-10-02", type: "gazetted" });

    const created = (await auditPayloads("create")).find((a) => a.resourceId === id);
    expect(created).toBeDefined();
    expect(created!.metadata).toMatchObject({ name: "Gandhi Jayanti", date: "2027-10-02" });
  });

  it("refuses non-admin roles (403)", async () => {
    expect((await post(mgr, { name: "X", date: "2027-01-01" })).statusCode).toBe(403);
    expect((await post(emp, { name: "X", date: "2027-01-01" })).statusCode).toBe(403);
  });
});
