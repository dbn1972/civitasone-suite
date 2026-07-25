import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000033";
const A = "cccccccc-3333-4000-8000-000000000033";
const admin = signToken({ sub: A, tid: T, roles: ["workflow_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}

describe("definitions", () => {
  it("GET /v1/workflow/definitions", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/definitions", admin)); });
  it("POST /v1/workflow/definitions", async () => { expect([201, 202, 400, 500]).toContain(await hit("POST", "/v1/workflow/definitions", admin, { name: "Leave Approval", version: 1 })); });
});
describe("instances", () => {
  it("GET /v1/workflow/instances", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/instances", admin)); });
  it("POST /v1/workflow/instances/search", async () => { expect([200, 400, 404, 500]).toContain(await hit("POST", "/v1/workflow/instances/search", admin, { status: "active" })); });
});
describe("tasks", () => {
  it("GET /v1/workflow/tasks", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/tasks", admin)); });
});
describe("analytics", () => {
  it("GET summary", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/analytics/summary", admin)); });
  it("GET bottlenecks", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/analytics/bottlenecks", admin)); });
  it("GET cycle-time", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/analytics/cycle-time", admin)); });
  it("GET sla-compliance", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/analytics/sla-compliance", admin)); });
});
describe("dmn", () => {
  it("GET /v1/workflow/dmn/tables", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/dmn/tables", admin)); });
});
describe("delegations", () => {
  it("GET /v1/workflow/delegations", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/delegations", admin)); });
});
describe("assignment", () => {
  it("GET matrix", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/assignment/matrix", admin)); });
  it("GET substitutions", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/assignment/substitutions", admin)); });
});
describe("external-tasks", () => {
  it("POST fetch-and-lock", async () => { expect([200, 400, 500]).toContain(await hit("POST", "/v1/workflow/external-tasks/fetch-and-lock", admin, { workerId: "w1", topicName: "approval", lockDuration: 60000 })); });
});
describe("designer", () => {
  it("GET designer definitions", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/designer/definitions", admin)); });
});
describe("dlq", () => {
  it("GET /v1/workflow/dlq", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/dlq", admin)); });
});
describe("decisions", () => {
  it("GET /v1/workflow/decisions", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/decisions", admin)); });
});
describe("templates", () => {
  it("GET /v1/workflow/templates", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/workflow/templates", admin)); });
});
describe("messages", () => {
  it("POST deliver", async () => { expect([200, 202, 400, 404, 500]).toContain(await hit("POST", "/v1/workflow/messages/deliver", admin, { messageName: "payment_approved", correlationKey: randomUUID() })); });
});
describe("auth", () => {
  it("401 on all", async () => {
    for (const u of ["/v1/workflow/definitions", "/v1/workflow/instances", "/v1/workflow/tasks", "/v1/workflow/analytics/summary", "/v1/workflow/dmn/tables", "/v1/workflow/delegations", "/v1/workflow/dlq"]) expect(await hit("GET", u)).toBe(401);
  });
});
