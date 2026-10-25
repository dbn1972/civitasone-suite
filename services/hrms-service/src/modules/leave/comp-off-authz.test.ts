/**
 * V4-B-01 -- comp-off must be HR-granted and owner-scoped.
 * Previously any employee could mint comp-off for anyone, list every
 * comp-off in the tenant, and redeem another employee's entry.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const EMP_A = "bbbbbbbb-0000-4000-8000-00000000000a";
const EMP_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ACTOR_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ACTOR_B = "aaaaaaaa-0000-4000-8000-00000000000b";
const ACTOR_HR = "aaaaaaaa-0000-4000-8000-0000000000f1";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b1";

vi.mock("../employee/actor-link.js", () => ({
  resolveEmployeeForActor: async (_tenant: string, actorId: string) =>
    actorId === "aaaaaaaa-0000-4000-8000-00000000000a" ? { id: "bbbbbbbb-0000-4000-8000-00000000000a" }
    : actorId === "aaaaaaaa-0000-4000-8000-00000000000b" ? { id: "bbbbbbbb-0000-4000-8000-00000000000b" }
    : undefined,
}));

import { buildApp } from "../../app.js";
import { sqlClient } from "../../shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s1" }, SECRET);
const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}` });
const grant = { employeeId: EMP_A, workedDate: "2026-01-26", holidayName: "Republic Day", hours: 8 };

afterAll(async () => { await sqlClient.end(); });

describe("V4-B-01 -- comp-off authorization", () => {
  it("rejects an employee minting comp-off (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: auth(ACTOR_A, ["employee"]), payload: grant });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("rejects a manager minting comp-off (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: auth(ACTOR_B, ["manager"]), payload: grant });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("scopes list and redeem to the owning employee; HR can grant and see all", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: auth(ACTOR_HR, ["hr_admin"]), payload: grant });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    // B cannot read A's comp-off by filter, nor see it in the unfiltered list.
    const peek = await app.inject({ method: "GET", url: `/v1/hrms/comp-off?employeeId=${EMP_A}`, headers: auth(ACTOR_B, ["employee"]) });
    expect(peek.statusCode).toBe(403);
    const own = await app.inject({ method: "GET", url: "/v1/hrms/comp-off", headers: auth(ACTOR_B, ["employee"]) });
    expect(own.statusCode).toBe(200);
    expect(own.json().data).toEqual([]);

    // B cannot redeem A's entry; it is reported as not found.
    const steal = await app.inject({ method: "POST", url: `/v1/hrms/comp-off/${id}/redeem`, headers: auth(ACTOR_B, ["employee"]) });
    expect(steal.statusCode).toBe(404);

    // A sees and redeems their own.
    const mine = await app.inject({ method: "GET", url: "/v1/hrms/comp-off", headers: auth(ACTOR_A, ["employee"]) });
    expect(mine.json().data.map((c: { id: string }) => c.id)).toEqual([id]);
    const redeem = await app.inject({ method: "POST", url: `/v1/hrms/comp-off/${id}/redeem`, headers: auth(ACTOR_A, ["employee"]) });
    expect(redeem.statusCode).toBe(200);

    // HR sees everything in the tenant.
    const all = await app.inject({ method: "GET", url: "/v1/hrms/comp-off?status=all", headers: auth(ACTOR_HR, ["hr_admin"]) });
    expect(all.json().data.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("an actor with no linked employee record is refused (403)", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/hrms/comp-off", headers: auth("aaaaaaaa-0000-4000-8000-0000000000ee", ["employee"]) });
    await app.close();
    expect(list.statusCode).toBe(403);
  });
});
