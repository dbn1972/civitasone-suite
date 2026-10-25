/**
 * V4-G-11 — certificate issuance linked to an application must require the
 * application to be `approved` and (for a fee-bearing service) paid, and a
 * successful issuance moves the application to `issued` in the same transaction.
 * Certificates without an applicationId keep the legacy maker-checker behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerIssuanceConsumers } from "../src/modules/issuance/consumer.js";
import type { FastifyInstance } from "fastify";

registerIssuanceConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const CITIZEN = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const FREE_SVC = randomUUID();
const FEE_SVC = randomUUID();
const A = { free: randomUUID(), unpaid: randomUUID(), paid: randomUUID(), review: randomUUID() };
let app: FastifyInstance;

const hdr = (actor: string) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["citizen_officer"], sid: "sess-v4g11" }, SECRET, 3600)}`,
  "content-type": "application/json", "x-tenant-id": TENANT,
});
const tx = <T>(fn: (sql: typeof sqlClient) => Promise<T>) => sqlClient.begin(async (sql) => {
  await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
  return fn(sql as unknown as typeof sqlClient);
}) as Promise<T>;

async function seedApp(id: string, serviceId: string, status: string) {
  await tx(async (sql) => sql`INSERT INTO application.citizen_applications (id, tenant_id, citizen_id, service_id, ref_no, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${CITIZEN}, ${serviceId}, ${"REF-" + id.slice(0, 8)}, ${status}, ${MAKER}, ${MAKER})`);
}
async function appStatus(id: string): Promise<string> {
  const rows = await tx(async (sql) => sql`SELECT status FROM application.citizen_applications WHERE id = ${id}`);
  return rows[0].status as string;
}
async function certState(id: string): Promise<{ status: string; blocked: boolean }> {
  const c = await tx(async (sql) => sql`SELECT status FROM issuance.certificates WHERE id = ${id}`);
  const e = await tx(async (sql) => sql`SELECT 1 FROM issuance.certificate_events WHERE certificate_id = ${id} AND event_type = 'issue_blocked'`);
  return { status: c[0].status as string, blocked: e.length > 0 };
}
async function requestAndApprove(applicationId?: string): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/citizen/certificates/requests", headers: hdr(MAKER),
    payload: { applicationId, certType: "BIRTH", subject: { name: "A" } } });
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  for (let i = 0; i < 200; i++) {
    const rows = await tx(async (sql) => sql`SELECT 1 FROM issuance.certificates WHERE id = ${id}`);
    if (rows.length) break;
    await new Promise((x) => setTimeout(x, 25));
  }
  const a = await app.inject({ method: "POST", url: `/v1/citizen/certificates/${id}/approve`, headers: hdr(CHECKER), payload: {} });
  expect(a.statusCode).toBe(202);
  for (let i = 0; i < 200; i++) {
    const s = await certState(id);
    if (s.status !== "requested" || s.blocked) return id;
    await new Promise((x) => setTimeout(x, 25));
  }
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await seedApp(A.free, FREE_SVC, "approved");
  await seedApp(A.unpaid, FEE_SVC, "approved");
  await seedApp(A.paid, FEE_SVC, "approved");
  await seedApp(A.review, FREE_SVC, "under_review");
  await tx(async (sql) => sql`INSERT INTO fee.schedules (tenant_id, service_id, name, base_amount, created_by, updated_by)
    VALUES (${TENANT}, ${FEE_SVC}, 'fee', 5000, ${MAKER}, ${MAKER})`);
  await tx(async (sql) => sql`INSERT INTO fee.payments (tenant_id, application_id, amount, method, status, created_by, updated_by)
    VALUES (${TENANT}, ${A.paid}, 5000, 'online', 'paid', ${MAKER}, ${MAKER})`);
}, 30000);

afterAll(async () => {
  await tx(async (sql) => {
    await sql`DELETE FROM issuance.certificate_events WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM issuance.certificates WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM fee.payments WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM fee.schedules WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM application.citizen_status_history WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM application.citizen_applications WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("V4-G-11 issuance is gated on the application and closes it", () => {
  it("approved + no fee: certificate becomes active and the application reaches issued", async () => {
    const id = await requestAndApprove(A.free);
    expect((await certState(id)).status).toBe("active");
    expect(await appStatus(A.free)).toBe("issued");
    const h = await tx(async (sql) => sql`SELECT from_status, to_status FROM application.citizen_status_history WHERE application_id = ${A.free}`);
    expect(h.map((r: { from_status: string; to_status: string }) => `${r.from_status}>${r.to_status}`)).toContain("approved>issued");
  });
  it("approved + fee-bearing + paid: issues", async () => {
    const id = await requestAndApprove(A.paid);
    expect((await certState(id)).status).toBe("active");
    expect(await appStatus(A.paid)).toBe("issued");
  });
  it("approved + fee-bearing + NO collected payment: blocked, application unchanged", async () => {
    const id = await requestAndApprove(A.unpaid);
    const s = await certState(id);
    expect(s.status).toBe("requested");
    expect(s.blocked).toBe(true);
    expect(await appStatus(A.unpaid)).toBe("approved");
  });
  it("application not approved: blocked, application unchanged", async () => {
    const id = await requestAndApprove(A.review);
    const s = await certState(id);
    expect(s.status).toBe("requested");
    expect(s.blocked).toBe(true);
    expect(await appStatus(A.review)).toBe("under_review");
  });
  it("unknown application id: blocked", async () => {
    const id = await requestAndApprove(randomUUID());
    const s = await certState(id);
    expect(s.status).toBe("requested");
    expect(s.blocked).toBe(true);
  });
  it("no applicationId: legacy maker-checker issuance still works", async () => {
    const id = await requestAndApprove(undefined);
    expect((await certState(id)).status).toBe("active");
  });
});
