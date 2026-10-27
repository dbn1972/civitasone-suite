/**
 * D4c #18 (GAP-PROCUREMENT-INDENTS-01): the indents list API supplies a true
 * total and per-status counts (like vendors/summary), so the page stops
 * presenting page-level counts as totals.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;

const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600);

async function seed(indentNo: string, status: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementIndents).values({
    id: randomUUID(), tenantId: TENANT, indentNo, department: "Finance", purpose: "d4c fixture",
    totalMinor: 100000n, committedMinor: 0n, currency: "INR", status, indentDate: "2026-09-01",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

beforeAll(async () => {
  app = await buildApp();
  for (let i = 0; i < 3; i++) await seed(`D4C18-P${i}`, "pending");
  for (let i = 0; i < 2; i++) await seed(`D4C18-A${i}`, "approved");
  await seed("D4C18-D0", "draft");
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT))));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/procurement/indents/summary", () => {
  it("returns the whole-tenant total and per-status counts", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/indents/summary", headers: { authorization: `Bearer ${tok(["procurement_officer"])}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { total: number; counts: Record<string, number> } };
    expect(body.data.total).toBe(6);
    expect(body.data.counts).toMatchObject({ pending: 3, approved: 2, draft: 1 });
  });

  it("total follows a status filter while counts stay per-status", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/indents/summary?status=pending,draft", headers: { authorization: `Bearer ${tok(["procurement_officer"])}` } });
    const body = res.json() as { data: { total: number; counts: Record<string, number> } };
    expect(body.data.total).toBe(4);
    expect(body.data.counts.approved).toBe(2);
  });

  it("narrows by indent-number search", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/indents/summary?q=D4C18-A", headers: { authorization: `Bearer ${tok(["procurement_officer"])}` } });
    const body = res.json() as { data: { total: number } };
    expect(body.data.total).toBe(2);
  });

  it("is role gated", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/indents/summary", headers: { authorization: `Bearer ${tok(["citizen"])}` } });
    expect(res.statusCode).toBe(403);
  });
});
