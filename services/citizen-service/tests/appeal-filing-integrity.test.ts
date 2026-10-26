/**
 * V4-G-12 — the statutory appeal filing window must be evaluated against the
 * SERVER-recorded decision time of the referenced application, never against a
 * client-supplied decisionDate; the application must exist in the caller tenant,
 * be owned by the filer (citizens), and be in a rejected (appealable) state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAppealConsumers } from "../src/modules/appeal/consumer.js";
import type { FastifyInstance } from "fastify";

registerAppealConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const OWNER = randomUUID();
const STRANGER = randomUUID();
const OFFICER = randomUUID();
const SERVICE = randomUUID();

const tok = (tenant: string, actor: string, roles: string[]) => signToken({ sub: actor, tid: tenant, roles, sid: "sess-v4g12" }, SECRET, 3600);
const hdr = (tenant: string, actor: string, roles: string[]) => ({
  authorization: `Bearer ${tok(tenant, actor, roles)}`, "content-type": "application/json", "x-tenant-id": tenant,
});
const isoDaysAgo = (d: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };
const isoDaysAhead = (d: number) => isoDaysAgo(-d);

const A = { recent: randomUUID(), old: randomUUID(), approved: randomUUID(), foreign: randomUUID() };
let app: FastifyInstance;

async function seedApp(id: string, tenant: string, owner: string, status: string, rejectedDaysAgo?: number) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    await sql`INSERT INTO application.citizen_applications (id, tenant_id, citizen_id, service_id, ref_no, status, created_by, updated_by)
      VALUES (${id}, ${tenant}, ${owner}, ${SERVICE}, ${"REF-" + id.slice(0, 8)}, ${status}, ${owner}, ${owner})`;
    if (rejectedDaysAgo !== undefined) {
      await sql`INSERT INTO application.citizen_status_history (tenant_id, application_id, from_status, to_status, created_at, created_by, updated_by)
        VALUES (${tenant}, ${id}, 'under_review', 'rejected', now() - make_interval(days => ${rejectedDaysAgo}), ${OFFICER}, ${OFFICER})`;
    }
  });
}

beforeAll(async () => {
  app = await buildApp();
  await seedApp(A.recent, TENANT, OWNER, "rejected", 5);
  await seedApp(A.old, TENANT, OWNER, "rejected", 45);
  await seedApp(A.approved, TENANT, OWNER, "approved");
  await seedApp(A.foreign, OTHER_TENANT, OWNER, "rejected", 5);
}, 30000);

afterAll(async () => {
  for (const [t, ids] of [[TENANT, [A.recent, A.old, A.approved]], [OTHER_TENANT, [A.foreign]]] as const) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${t}, true)`;
      for (const id of ids) {
        await sql`DELETE FROM application.citizen_status_history WHERE application_id = ${id}`;
        await sql`DELETE FROM application.citizen_applications WHERE id = ${id}`;
      }
    }).catch(() => {});
  }
  await app.close();
  await sqlClient.end();
});

const file = (h: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/citizen/appeals", headers: h, payload: { grounds: "unfair", ...payload } });

describe("V4-G-12 appeal filing integrity", () => {
  it("a time-barred appeal cannot be revived by a fresh client decisionDate", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: A.old, decisionDate: isoDaysAgo(0) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FILING_WINDOW_EXPIRED");
  });

  it("a future client decisionDate cannot extend the window of an old decision", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: A.old, decisionDate: isoDaysAhead(400) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FILING_WINDOW_EXPIRED");
  });

  it("an in-window rejection files and persists the SERVER decision date", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: A.recent, decisionDate: isoDaysAgo(0) });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    let got: { decisionDate?: string; citizenId?: string } | null = null;
    for (let i = 0; i < 100 && !got; i++) {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${id}`, headers: hdr(TENANT, OWNER, ["citizen"]) });
      if (g.statusCode === 200) got = g.json();
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(got).not.toBeNull();
    expect(String(got!.decisionDate).slice(0, 10)).toBe(isoDaysAgo(5));
    expect(got!.citizenId).toBe(OWNER);
  });

  it("another citizen cannot file against someone else's application (404)", async () => {
    const res = await file(hdr(TENANT, STRANGER, ["citizen"]), { applicationId: A.recent, decisionDate: isoDaysAgo(1) });
    expect(res.statusCode).toBe(404);
  });

  it("an unknown applicationId is rejected (404)", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: randomUUID(), decisionDate: isoDaysAgo(1) });
    expect(res.statusCode).toBe(404);
  });

  it("another tenant's application is invisible (404)", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: A.foreign, decisionDate: isoDaysAgo(1) });
    expect(res.statusCode).toBe(404);
  });

  it("an application that was not rejected is not appealable (409)", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { applicationId: A.approved, decisionDate: isoDaysAgo(1) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_APPEALABLE");
  });

  it("without an applicationId a future decisionDate is refused (422)", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { decisionRef: "ORD-1", decisionDate: isoDaysAhead(400) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_DECISION_DATE");
  });

  it("without an applicationId an in-window past decisionDate still files", async () => {
    const res = await file(hdr(TENANT, OWNER, ["citizen"]), { decisionRef: "ORD-2", decisionDate: isoDaysAgo(3) });
    expect(res.statusCode).toBe(202);
  });
});
