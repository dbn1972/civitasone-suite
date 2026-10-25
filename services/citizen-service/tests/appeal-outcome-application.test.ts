/**
 * V4-G-10 — an issued appellate order must reach the application: an overturned
 * order re-opens the rejected application as approved, a remanded order returns
 * it to review; an upheld order (or an application that is no longer rejected)
 * leaves it untouched. The generic status route keeps `rejected` terminal.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAppealConsumers } from "../src/modules/appeal/consumer.js";
import { assertStatusTransition, assertAppealOutcomeTransition } from "../src/modules/application/domain.js";
import type { FastifyInstance } from "fastify";

registerAppealConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const CITIZEN = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const SERVICE = randomUUID();
const ids = { overturned: randomUUID(), remanded: randomUUID(), upheld: randomUUID(), notRejected: randomUUID() };
const appeals = { overturned: randomUUID(), remanded: randomUUID(), upheld: randomUUID(), notRejected: randomUUID() };
let app: FastifyInstance;

const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: CHECKER, tid: TENANT, roles: ["citizen_officer"], sid: "sess-v4g10" }, SECRET, 3600)}`,
  "content-type": "application/json", "x-tenant-id": TENANT,
});

async function seed(appId: string, appealId: string, appStatus: string, orderType: string) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO application.citizen_applications (id, tenant_id, citizen_id, service_id, ref_no, status, created_by, updated_by)
      VALUES (${appId}, ${TENANT}, ${CITIZEN}, ${SERVICE}, ${"REF-" + appId.slice(0, 8)}, ${appStatus}, ${MAKER}, ${MAKER})`;
    await sql`INSERT INTO appeal.appeals (id, tenant_id, application_id, citizen_id, grounds, status, order_type, prepared_by, prepared_at, created_by, updated_by)
      VALUES (${appealId}, ${TENANT}, ${appId}, ${CITIZEN}, 'g', 'hearing', ${orderType}, ${MAKER}, now(), ${MAKER}, ${MAKER})`;
  });
}
async function appStatus(appId: string): Promise<string> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT status FROM application.citizen_applications WHERE id = ${appId}`;
  });
  return rows[0].status as string;
}
async function appealStatus(id: string): Promise<string> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT status FROM appeal.appeals WHERE id = ${id}`;
  });
  return rows[0].status as string;
}
async function issue(appealId: string) {
  const res = await app.inject({ method: "POST", url: `/v1/citizen/appeals/${appealId}/order/issue`, headers: hdr(), payload: {} });
  expect(res.statusCode).toBe(202);
  for (let i = 0; i < 200; i++) {
    const s = await appealStatus(appealId);
    if (s !== "hearing") return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("appeal order was never applied");
}

beforeAll(async () => {
  app = await buildApp();
  await seed(ids.overturned, appeals.overturned, "rejected", "overturned");
  await seed(ids.remanded, appeals.remanded, "rejected", "remanded");
  await seed(ids.upheld, appeals.upheld, "rejected", "upheld");
  await seed(ids.notRejected, appeals.notRejected, "approved", "overturned");
}, 30000);

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM appeal.appeals WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM application.citizen_status_history WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM application.citizen_applications WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("V4-G-10 appeal outcome reaches the application", () => {
  it("overturned order re-opens the rejected application as approved + records history", async () => {
    expect(await issue(appeals.overturned)).toBe("decided");
    expect(await appStatus(ids.overturned)).toBe("approved");
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`SELECT from_status, to_status FROM application.citizen_status_history WHERE application_id = ${ids.overturned}`;
    });
    expect(rows.map((r: { from_status: string; to_status: string }) => `${r.from_status}>${r.to_status}`)).toContain("rejected>approved");
  });
  it("remanded order returns the application to review", async () => {
    expect(await issue(appeals.remanded)).toBe("remanded");
    expect(await appStatus(ids.remanded)).toBe("under_review");
  });
  it("upheld order leaves the application rejected", async () => {
    expect(await issue(appeals.upheld)).toBe("decided");
    expect(await appStatus(ids.upheld)).toBe("rejected");
  });
  it("an application that is no longer rejected is left untouched", async () => {
    expect(await issue(appeals.notRejected)).toBe("decided");
    expect(await appStatus(ids.notRejected)).toBe("approved");
  });
  it("only the appeal-outcome path may leave rejected; the generic transition table stays terminal", () => {
    expect(() => assertStatusTransition("rejected", "approved")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertStatusTransition("rejected", "under_review")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertAppealOutcomeTransition("rejected", "approved")).not.toThrow();
    expect(() => assertAppealOutcomeTransition("rejected", "under_review")).not.toThrow();
    expect(() => assertAppealOutcomeTransition("rejected", "issued")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertAppealOutcomeTransition("approved", "under_review")).toThrow(/INVALID_TRANSITION/);
  });
});
