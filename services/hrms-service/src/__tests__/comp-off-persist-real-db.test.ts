/**
 * V4-B-01 -- comp-off is persisted (was an in-process array), tenant-isolated
 * under FORCE RLS, written by an idempotent CQRS consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerLeaveConsumers } from "../modules/leave/consumer.js";
import { COMMANDS } from "../topics.js";

registerLeaveConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff0ff0-b001-4000-8000-0000000000a1";
const OTHER_TENANT = "c0ff0ff0-b001-4000-8000-0000000000a2";
const HR = "c0ff0ff0-b001-4000-8000-0000000000f1";
const EMP = "c0ff0ff0-b001-4000-8000-0000000000e1";
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);
const hr = (tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: HR, tid, roles: ["hr_admin"], sid: "s-co" }, SECRET)}` });

let app: Awaited<ReturnType<typeof buildApp>>;
const wipe = async () => {
  for (const t of [TENANT, OTHER_TENANT]) await asTenant(t, (tx) => tx`DELETE FROM leave.hrms_comp_off WHERE tenant_id = ${t}`);
};
beforeAll(async () => { await wipe(); app = await buildApp(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const grant = { employeeId: EMP, workedDate: "2026-01-26", holidayName: "Republic Day", hours: 8, reason: "on-call" };

describe("V4-B-01 comp-off persistence", () => {
  it("earn is 202 and the consumer persists a tenant-scoped row (readable straight from Postgres)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: hr(), payload: grant });
    expect(r.statusCode).toBe(202);
    const id = r.json().id as string;
    await drain();
    const rows = await asTenant(TENANT, (tx) => tx`SELECT status, hours, worked_date::text AS d FROM leave.hrms_comp_off WHERE id = ${id}`);
    expect(rows).toEqual([{ status: "available", hours: 8, d: "2026-01-26" }]);
    // FORCE RLS: another tenant context cannot see it.
    expect(await asTenant(OTHER_TENANT, (tx) => tx`SELECT 1 FROM leave.hrms_comp_off WHERE id = ${id}`)).toHaveLength(0);
    // And the other tenant's HR cannot read or redeem it through the API.
    const list = await app.inject({ method: "GET", url: "/v1/hrms/comp-off?status=all", headers: hr(OTHER_TENANT) });
    expect(list.json().data).toEqual([]);
    const steal = await app.inject({ method: "POST", url: `/v1/hrms/comp-off/${id}/redeem`, headers: hr(OTHER_TENANT) });
    expect(steal.statusCode).toBe(404);
  });

  it("a duplicate grant for the same employee+day is refused (409) and never mints a second row", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: hr(), payload: grant });
    expect(r.statusCode).toBe(409);
    await drain();
    const n = await asTenant(TENANT, (tx) => tx`SELECT count(*)::int AS n FROM leave.hrms_comp_off WHERE employee_id = ${EMP}`);
    expect(n[0]!.n).toBe(1);
  });

  it("redeem flips available->redeemed exactly once; a replayed command (same messageId) is a no-op", async () => {
    const found = await asTenant(TENANT, (tx) => tx`SELECT id FROM leave.hrms_comp_off WHERE employee_id = ${EMP}`);
    const id = found[0]!.id as string;
    const r = await app.inject({ method: "POST", url: `/v1/hrms/comp-off/${id}/redeem`, headers: hr() });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = async () => (await asTenant(TENANT, (tx) => tx`SELECT status, version, redeemed_at FROM leave.hrms_comp_off WHERE id = ${id}`))[0]!;
    const first = await row();
    expect(first.status).toBe("redeemed");
    expect(first.redeemed_at).not.toBeNull();

    // Replay the exact same command: markProcessed must swallow it.
    const messageId = randomUUID();
    const cmd = { messageId, type: COMMANDS.compOffRedeem, tenantId: TENANT, actorId: HR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, ownerEmployeeId: null } };
    await queue.publish(COMMANDS.compOffRedeem, cmd);
    await queue.publish(COMMANDS.compOffRedeem, cmd);
    await drain();
    expect((await row()).version).toBe(first.version);

    const again = await app.inject({ method: "POST", url: `/v1/hrms/comp-off/${id}/redeem`, headers: hr() });
    expect(again.statusCode).toBe(409);
  });

  it("the consumer guarded write re-asserts ownership even if the route check were bypassed", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: hr(), payload: { ...grant, workedDate: "2026-08-15" } });
    const id = r.json().id as string;
    await drain();
    const stranger = randomUUID();
    await queue.publish(COMMANDS.compOffRedeem, {
      messageId: randomUUID(), type: COMMANDS.compOffRedeem, tenantId: TENANT, actorId: HR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, ownerEmployeeId: stranger },
    });
    await drain();
    const st = await asTenant(TENANT, (tx) => tx`SELECT status FROM leave.hrms_comp_off WHERE id = ${id}`);
    expect(st[0]!.status).toBe("available");
  });

  it("table has ENABLE + FORCE row level security", async () => {
    const r = await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'leave.hrms_comp_off'::regclass`;
    expect(r[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
