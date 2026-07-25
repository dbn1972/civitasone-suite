/**
 * Route-layer smoke coverage for the SVC-041/043/046/049/050 HTTP surfaces.
 *
 * Exercises each new route + command wrapper through buildApp/inject with a
 * valid token so authz, zod validation, and the command publish/pre-read paths
 * all run. Create/publish routes return 202; pre-read routes on a random id
 * return 404 — either way the handler executes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bdbdbdbd-1111-4000-8000-0000000000d1";
const ACTOR  = "bebebebe-0000-4000-8000-000000000001";
const tok = signToken({ sub: ACTOR, tid: TENANT, roles: ["super_admin", "procurement_admin", "procurement_officer"], sid: "s" }, SECRET, 3600);
const H = { authorization: `Bearer ${tok}`, "content-type": "application/json" };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const ok = (c: number) => expect([200, 202, 404, 409, 503]).toContain(c);

describe("SVC-041 planning routes", () => {
  const rid = randomUUID();
  it("create / aggregate / list / lifecycle", async () => {
    ok((await app.inject({ method: "POST", url: "/v1/procurement/plans", headers: H, payload: { planYear: 2028, title: "FY28 Plan", department: "IT", lines: [{ itemCode: "L1", description: "Laptop", estimatedValueMinor: 100 }] } })).statusCode);
    ok((await app.inject({ method: "POST", url: "/v1/procurement/plans/aggregate-from-indents", headers: H, payload: { planYear: 2028, title: "Agg", department: "IT", indentIds: [randomUUID()] } })).statusCode);
    ok((await app.inject({ method: "GET", url: "/v1/procurement/plans", headers: H })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/plans/${rid}`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/plans/${rid}/submit`, headers: H, payload: {} })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/plans/${rid}/approve`, headers: H, payload: {} })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/plans/${rid}/reject`, headers: H, payload: { reason: "no budget" } })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/plans/${rid}/link-tender`, headers: H, payload: { lineId: randomUUID(), tenderId: randomUUID() } })).statusCode);
  });
});

describe("SVC-046 PO amendment/milestone/closure routes", () => {
  const pid = randomUUID();
  it("amendment + milestone + close", async () => {
    ok((await app.inject({ method: "POST", url: `/v1/procurement/pos/${pid}/amendments`, headers: H, payload: { amendmentType: "change_order", reason: "extra scope", deltaMinor: 1000 } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/pos/${pid}/amendments`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${pid}/amendments/${randomUUID()}/approve`, headers: H, payload: {} })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${pid}/amendments/${randomUUID()}/reject`, headers: H, payload: { reason: "no" } })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/pos/${pid}/milestones`, headers: H, payload: { title: "M1", amountMinor: 500 } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/pos/${pid}/milestones`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${pid}/milestones/${randomUUID()}`, headers: H, payload: { status: "delivered" } })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/pos/${pid}/close`, headers: H, payload: {} })).statusCode);
  });
});

describe("SVC-049 vendor scorecard + show-cause routes", () => {
  const vid = randomUUID();
  it("scorecard + show-cause", async () => {
    ok((await app.inject({ method: "GET", url: `/v1/procurement/vendors/${vid}/scorecard`, headers: H })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/vendors/${vid}/scorecard/recompute`, headers: H, payload: {} })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/vendors/${vid}/show-cause`, headers: H, payload: { reason: "quality failures repeated" } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/vendors/${vid}/show-cause`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/show-cause/${randomUUID()}/respond`, headers: H, payload: { response: "corrected" } })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/show-cause/${randomUUID()}/appeal`, headers: H, payload: { appealText: "appeal" } })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/show-cause/${randomUUID()}/decide`, headers: H, payload: { decision: "upheld", uphold: true } })).statusCode);
  });
});

describe("SVC-043 tender docs routes", () => {
  const tid = randomUUID();
  it("documents + corrigenda + prebid", async () => {
    ok((await app.inject({ method: "POST", url: `/v1/procurement/tenders/${tid}/documents`, headers: H, payload: { docType: "nit", title: "NIT", storageRef: "s3://x" } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tid}/documents`, headers: H })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/tenders/${tid}/corrigenda`, headers: H, payload: { title: "Corr" } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tid}/corrigenda`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/tenders/${tid}/corrigenda/${randomUUID()}/republish`, headers: H, payload: {} })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/tenders/${tid}/prebid-queries`, headers: H, payload: { question: "warranty?" } })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tid}/prebid-queries`, headers: H })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/tenders/${tid}/prebid-queries/${randomUUID()}/answer`, headers: H, payload: { answer: "3y" } })).statusCode);
    ok((await app.inject({ method: "PATCH", url: `/v1/procurement/tenders/${tid}/prebid-queries/${randomUUID()}/publish`, headers: H, payload: {} })).statusCode);
  });
});

describe("SVC-050 gem integration routes", () => {
  it("config + refs (not configured)", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/procurement/gem/integration/config", headers: H })).statusCode).toBe(200);
    ok((await app.inject({ method: "POST", url: "/v1/procurement/gem/integration/exchange", headers: H, payload: { provider: "gem", entityType: "tender", entityId: "T1" } })).statusCode);
    ok((await app.inject({ method: "GET", url: "/v1/procurement/gem/integration/refs", headers: H })).statusCode);
    ok((await app.inject({ method: "GET", url: `/v1/procurement/gem/integration/refs/${randomUUID()}`, headers: H })).statusCode);
    ok((await app.inject({ method: "POST", url: `/v1/procurement/gem/integration/refs/${randomUUID()}/reconcile`, headers: H, payload: {} })).statusCode);
  });
});
