/**
 * Contract: what the web reads from citizen-service for the three engagement
 * screens. The REAL list responses (route -> queue -> consumer -> DB -> route)
 * are parsed with the very schemas apps/web/src/app/_data/loaders.ts uses as
 * `responseSchema` (CitizenAlertListSchema / CitizenNoticeListSchema /
 * CitizenSurveyListSchema from @civitasone/schemas/web), and the row keys must
 * equal the schema keys exactly — so a field renamed on either side fails here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  CitizenAlertListSchema, CitizenAlertSchema, CitizenNoticeListSchema, CitizenNoticeSchema,
  CitizenSurveyListSchema, CitizenSurveySchema,
} from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerEngagementConsumers } from "../src/modules/engagement/consumer.js";
import type { FastifyInstance } from "fastify";

registerEngagementConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c3c3c3c3-0000-4000-8000-000000000042";
const ADMIN = "44444444-0000-4000-8000-000000000042";
const CITIZEN = "11111111-0000-4000-8000-000000000042";
const OFFICER = "33333333-0000-4000-8000-000000000042"; // maker (maker-checker: the admin checker must not be the creator)
const h = (actor: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "sess-contract" }, SECRET, 3600)}`,
  "content-type": "application/json", "x-tenant-id": TENANT,
});

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function seedPublished(kind: "alerts" | "notices" | "surveys"): Promise<string> {
  const body = kind === "alerts" ? { title: "Contract alert" }
    : kind === "notices" ? { subject: "Contract notice", department: "Revenue", type: "statutory" }
    : { surveyName: "Contract survey", questions: [{ id: "q1", text: "Rate us", type: "rating" }], targetResponses: 4, startsOn: "2026-11-01" };
  const created = await app.inject({ method: "POST", url: `/v1/citizen/${kind}`, headers: h(OFFICER, ["citizen_officer"]), payload: body });
  expect(created.statusCode).toBe(202);
  const id = created.json().id as string;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/citizen/${kind}/${id}`, headers: h(ADMIN, ["citizen_admin"]) })).statusCode === 200);
  const pub = await app.inject({ method: "POST", url: `/v1/citizen/${kind}/${id}/publish`, headers: h(ADMIN, ["citizen_admin"]), payload: {} });
  expect(pub.statusCode).toBe(202);
  return id;
}

describe("engagement list responses satisfy the web loaders' schemas, field for field", () => {
  it("alerts", async () => {
    const id = await seedPublished("alerts");
    const body = await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: "/v1/citizen/alerts", headers: h(CITIZEN, ["citizen"]) });
      return r.json().data.some((a: { id: string }) => a.id === id) ? r.json() : null;
    });
    const parsed = CitizenAlertListSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(Object.keys(CitizenAlertSchema.shape).sort());
  });

  it("notices", async () => {
    const id = await seedPublished("notices");
    const body = await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: "/v1/citizen/notices", headers: h(CITIZEN, ["citizen"]) });
      return r.json().data.some((n: { id: string }) => n.id === id) ? r.json() : null;
    });
    expect(CitizenNoticeListSchema.safeParse(body).success).toBe(true);
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(Object.keys(CitizenNoticeSchema.shape).sort());
    // Type labels are the exact strings NoticesTable counts on.
    expect(body.data.find((n: { id: string }) => n.id === id).type).toBe("Statutory");
  });

  it("surveys", async () => {
    const id = await seedPublished("surveys");
    const body = await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: "/v1/citizen/surveys", headers: h(CITIZEN, ["citizen"]) });
      return r.json().data.some((s: { id: string }) => s.id === id) ? r.json() : null;
    });
    expect(CitizenSurveyListSchema.safeParse(body).success).toBe(true);
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(Object.keys(CitizenSurveySchema.shape).sort());
    const row = body.data.find((s: { id: string }) => s.id === id);
    expect(row.status).toBe("active");
    expect(row.period).toBe("From 01 Nov 2026");
    expect(typeof row.responses).toBe("number");
  });
});
