/**
 * GAP-CITIZEN-REQUESTS-07: the web grievance list/create (GET/POST
 * /v1/citizen/grievances) rely on the SERVER to scope rows, so pin it here:
 *   - citizen A lists only A's grievances (never B's), and may not ask for B's via ?citizenId (403);
 *   - an officer lists tenant-wide;
 *   - POST attributes the grievance to the CALLER and records an audit event
 *     (service/action/resource/actor) in the same transaction as the write;
 *   - a role outside the citizen portal set is refused (403).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";

registerGrievanceConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const CIT_A = randomUUID();
const CIT_B = randomUUID();
const OFFICER = randomUUID();
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json", "x-tenant-id": TENANT });

let app: FastifyInstance;
const ids: Record<string, string> = {};

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}
function listIds(body: unknown): string[] {
  const arr = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
  return (arr as { id: string }[]).map((g) => g.id);
}

beforeAll(async () => {
  app = await buildApp();
  for (const [key, citizen] of [["a", CIT_A], ["b", CIT_B]] as const) {
    const r = await app.inject({
      method: "POST", url: "/v1/citizen/grievances", headers: hdr(citizen, ["citizen"]),
      // no citizenId in the body: the server must attribute it to the caller
      payload: { category: "water", subject: `leak ${key}`, description: "pipe burst near the school" },
    });
    expect(r.statusCode).toBe(202);
    ids[key] = r.json().id;
  }
  for (const key of ["a", "b"]) {
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/citizen/grievances/${ids[key]}`, headers: hdr(OFFICER, ["citizen_officer"]) })).statusCode === 200);
  }
}, 30000);

afterAll(async () => {
  await sqlClient
    .begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`DELETE FROM grievance.citizen_grievance_actions WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM grievance.citizen_grievances WHERE tenant_id = ${TENANT}`;
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("GET/POST /v1/citizen/grievances — server-side scoping and audit (GAP-CITIZEN-REQUESTS-07)", () => {
  it("a citizen lists only their own grievances", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/grievances", headers: hdr(CIT_A, ["citizen"]) });
    expect(res.statusCode).toBe(200);
    const got = listIds(res.json());
    expect(got).toContain(ids.a);
    expect(got).not.toContain(ids.b);
  });

  it("a citizen asking for another citizen's list via ?citizenId is refused (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/citizen/grievances?citizenId=${CIT_B}`, headers: hdr(CIT_A, ["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("an officer lists tenant-wide (both citizens' rows)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/grievances", headers: hdr(OFFICER, ["citizen_officer"]) });
    expect(res.statusCode).toBe(200);
    const got = listIds(res.json());
    expect(got).toEqual(expect.arrayContaining([ids.a, ids.b]));
  });

  it("a role outside the citizen portal set cannot list or create (403)", async () => {
    const h = hdr(randomUUID(), ["finance_officer"]);
    expect((await app.inject({ method: "GET", url: "/v1/citizen/grievances", headers: h })).statusCode).toBe(403);
    const c = await app.inject({ method: "POST", url: "/v1/citizen/grievances", headers: h, payload: { category: "water", subject: "x", description: "y" } });
    expect(c.statusCode).toBe(403);
  });

  it("create is attributed to the caller and emits an audit event with that actor", async () => {
    const row = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT citizen_id FROM grievance.citizen_grievances WHERE id = ${ids.a}`;
    });
    expect(row[0]?.citizen_id).toBe(CIT_A);

    const audit = await waitFor(async () => {
      const rows = await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`SELECT actor_id, payload FROM _outbox.messages
                   WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'resourceId' = ${ids.a}`;
      });
      return rows[0];
    });
    expect(audit.actor_id).toBe(CIT_A);
    expect(audit.payload).toMatchObject({ service: "citizen", resourceType: "citizen_grievance", outcome: "success" });
  });
});
