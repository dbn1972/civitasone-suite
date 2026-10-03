/**
 * GAP-HR-SHIFTS-01 -- shift definition create/edit, real DB, no mocks.
 * POST/PATCH /v1/hrms/shifts: HR-only, zod-validated, 202 + consumer write,
 * duplicate name 409, audited with before/after, tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_attendance_Consumers } from "../modules/attendance/f3-consumer.js";

registerF3_attendance_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a906-4000-8000-000000000a96";
const OTHER_TENANT = "facade00-a906-4000-8000-000000000a97";
const tok = (roles: string[], tid = TENANT) => signToken({ sub: randomUUID(), tid, roles, sid: "sess-shifts-write" }, SECRET);
const hr = { authorization: `Bearer ${tok(["hr_officer"])}` };
const mgr = { authorization: `Bearer ${tok(["manager"])}` };
const emp = { authorization: `Bearer ${tok(["employee"])}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) await asTenant(t, (tx) => tx`DELETE FROM attendance.hrms_shifts WHERE tenant_id = ${t}`);
}
beforeAll(async () => { await cleanup(); app = await buildApp(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const post = (headers: Record<string, string>, payload: unknown) => app.inject({ method: "POST", url: "/v1/hrms/shifts", headers, payload: payload as object });
const patch = (headers: Record<string, string>, id: string, payload: unknown) => app.inject({ method: "PATCH", url: `/v1/hrms/shifts/${id}`, headers, payload: payload as object });
const list = async () => (await app.inject({ method: "GET", url: "/v1/hrms/shifts", headers: hr })).json().data as Array<Record<string, unknown>>;

describe("POST/PATCH /v1/hrms/shifts (GAP-HR-SHIFTS-01)", () => {
  it("refuses manager and employee (403) and writes nothing", async () => {
    expect((await post(mgr, { name: "X", startTime: "09:00", endTime: "17:00" })).statusCode).toBe(403);
    expect((await post(emp, { name: "X", startTime: "09:00", endTime: "17:00" })).statusCode).toBe(403);
    expect(await list()).toHaveLength(0);
  });

  it("an HR officer creates a shift (202 then listed) including a midnight-crossing night shift", async () => {
    const r = await post(hr, { name: "General", startTime: "09:00", endTime: "17:30", graceMins: 15 });
    expect(r.statusCode).toBe(202);
    const n = await post(hr, { name: "Night", startTime: "22:00", endTime: "06:00", graceMins: 10 });
    expect(n.statusCode).toBe(202);
    await drain();
    const rows = await list();
    expect(rows.map((s) => s.name).sort()).toEqual(["General", "Night"]);
    const night = rows.find((s) => s.name === "Night")!;
    expect(night.graceMinutes).toBe(10);
    expect(night.workingMinutes).toBe(480); // 22:00-06:00 wraps past midnight
  });

  it("validates the body at the boundary (400) and rejects equal start/end", async () => {
    expect((await post(hr, { name: "", startTime: "09:00", endTime: "17:00" })).statusCode).toBe(400);
    expect((await post(hr, { name: "Bad", startTime: "9am", endTime: "17:00" })).statusCode).toBe(400);
    expect((await post(hr, { name: "Bad", startTime: "09:00", endTime: "09:00" })).statusCode).toBe(400);
    expect((await post(hr, { name: "Bad", startTime: "09:00", endTime: "17:00", graceMins: 999 })).statusCode).toBe(400);
  });

  it("a duplicate name (case-insensitive) is 409", async () => {
    const r = await post(hr, { name: "general", startTime: "10:00", endTime: "18:00" });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SHIFT_NAME_EXISTS");
  });

  it("PATCH updates only the given fields, bumps version and emits an audit event with before/after", async () => {
    const general = (await list()).find((s) => s.name === "General")!;
    const r = await patch(hr, general.id as string, { graceMins: 30 });
    expect(r.statusCode).toBe(202);
    await drain();
    const after = (await list()).find((s) => s.name === "General")!;
    expect(after.graceMinutes).toBe(30);
    expect(after.startTime).toBe(general.startTime);
    const v = await asTenant(TENANT, (tx) => tx`SELECT version FROM attendance.hrms_shifts WHERE id = ${general.id as string}`);
    expect(v[0]!.version).toBe(2);
    const ev = await asTenant(TENANT, (tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' ORDER BY created_at DESC LIMIT 1`);
    const payload = (typeof ev[0]!.payload === "string" ? JSON.parse(ev[0]!.payload as string) : ev[0]!.payload) as { resourceType: string; metadata: { before: { graceMins: number }; after: { graceMins: number } } };
    expect(payload.resourceType).toBe("shift");
    expect(payload.metadata.before.graceMins).toBe(15);
    expect(payload.metadata.after.graceMins).toBe(30);
  });

  it("PATCH rejects a rename onto another shift (409), equal times after merge (422), unknown id (404), empty body (400)", async () => {
    const rows = await list();
    const general = rows.find((s) => s.name === "General")!;
    expect((await patch(hr, general.id as string, { name: "Night" })).statusCode).toBe(409);
    expect((await patch(hr, general.id as string, { endTime: "09:00" })).statusCode).toBe(422);
    expect((await patch(hr, randomUUID(), { graceMins: 5 })).statusCode).toBe(404);
    expect((await patch(hr, general.id as string, {})).statusCode).toBe(400);
  });

  it("is tenant-scoped: another tenant's HR cannot see or edit this tenant's shift", async () => {
    const general = (await list()).find((s) => s.name === "General")!;
    const other = { authorization: `Bearer ${tok(["hr_admin"], OTHER_TENANT)}` };
    expect((await patch(other, general.id as string, { graceMins: 1 })).statusCode).toBe(404);
    const theirs = (await app.inject({ method: "GET", url: "/v1/hrms/shifts", headers: other })).json().data as unknown[];
    expect(theirs).toHaveLength(0);
  });
});
