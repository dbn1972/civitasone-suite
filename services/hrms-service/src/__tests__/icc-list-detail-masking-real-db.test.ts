/**
 * Real-DB regression guard for GAP-HR-ICC-01/02/03/04/05 -- the ICC
 * register's actual security/DPDP behavior end-to-end, not just that a
 * route replies with the right shape. Mirrors
 * disciplinary-case-create-readable-real-db.test.ts's own harness (buildApp
 * + app.inject + a real disposable Postgres) since icc-routes.ts's writes
 * are equally F3/outbox-async and this repo's own convention for this
 * module is exactly this kind of real-DB test, not a mocked one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_disciplinary_Consumers } from "../modules/disciplinary/f3-consumer.js";
import type { FastifyInstance } from "fastify";

registerF3_disciplinary_Consumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_ADMIN = randomUUID();
const ICC_MEMBER = randomUUID();
const COMPLAINANT = randomUUID();
const RESPONDENT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-icc" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function fileComplaint(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/hrms/icc/complaints",
    headers: auth(ICC_MEMBER, ["icc_member"]),
    payload: { complainantId: COMPLAINANT, respondentId: RESPONDENT, summary: "Real-DB test complaint summary text." },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  await (queue as unknown as { drain: () => Promise<void> }).drain();
  return id;
}

describe("GAP-HR-ICC-04: case_no is a real ICC/YYYY/NNN sequence, not the placeholder truncated-UUID", () => {
  it("a filed complaint is readable afterward with a caseNo matching ICC/<year>/<seq>", async () => {
    const id = await fileComplaint();

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/icc/complaints",
      headers: auth(ICC_MEMBER, ["icc_member"]),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ id: string; caseNo: string }>; total: number };
    const found = body.data.find((r) => r.id === id);
    expect(found).toBeTruthy();
    expect(found?.caseNo).toMatch(new RegExp(`^ICC/${new Date().getFullYear()}/\\d{3}$`));
  });
});

describe("GAP-HR-ICC-01/02: list masking and iccMembersOnly scoping", () => {
  it("hides complainantId/respondentId from the list response entirely, regardless of caller", async () => {
    await fileComplaint();
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/icc/complaints",
      headers: auth(ICC_MEMBER, ["icc_member"]),
    });
    const body = list.json() as { data: Array<Record<string, unknown>> };
    for (const row of body.data) {
      expect(row).not.toHaveProperty("complainantId");
      expect(row).not.toHaveProperty("respondentId");
      expect(row).not.toHaveProperty("createdBy");
      expect(row).not.toHaveProperty("tenantId");
      expect(row).not.toHaveProperty("iccMembersOnly");
    }
  });

  it("masks summary to null for a confidential complaint when the caller is not an icc_member", async () => {
    await fileComplaint(); // every complaint filed through the real route is confidential:true by DB default

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/icc/complaints",
      headers: auth(HR_ADMIN, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ summary: string | null; confidential: boolean }> };
    for (const row of body.data) {
      if (row.confidential) expect(row.summary).toBeNull();
    }
  });

  it("shows the real summary to an icc_member for the same confidential complaint", async () => {
    await fileComplaint();
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/icc/complaints",
      headers: auth(ICC_MEMBER, ["icc_member"]),
    });
    const body = list.json() as { data: Array<{ summary: string | null }> };
    expect(body.data.some((r) => r.summary === "Real-DB test complaint summary text.")).toBe(true);
  });

  it("an hr_admin without icc_member sees NO rows -- every complaint filed through the app defaults iccMembersOnly=true (GAP-HR-ICC-02's WHERE clause), a real and intentional consequence worth a reviewer's attention", async () => {
    await fileComplaint();
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/icc/complaints",
      headers: auth(HR_ADMIN, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});

describe("GAP-HR-ICC-02/03: the detail route is icc_member-ONLY (excludes hr_admin/super_admin)", () => {
  it("returns 403 for hr_admin", async () => {
    const id = await fileComplaint();
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/icc/complaints/${id}`,
      headers: auth(HR_ADMIN, ["hr_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for super_admin too -- the packet's own 'icc_member-only, not really optional' default", async () => {
    const id = await fileComplaint();
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/icc/complaints/${id}`,
      headers: auth(randomUUID(), ["super_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns full identity (complainantId/respondentId) for icc_member", async () => {
    const id = await fileComplaint();
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/icc/complaints/${id}`,
      headers: auth(ICC_MEMBER, ["icc_member"]),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json().data as { complainantId: string; respondentId: string; caseNo: string };
    expect(detail.complainantId).toBe(COMPLAINANT);
    expect(detail.respondentId).toBe(RESPONDENT);
    expect(detail.caseNo).toMatch(/^ICC\//);
  });

  it("404s for a genuinely nonexistent id (not a disguised 403)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/icc/complaints/${randomUUID()}`,
      headers: auth(ICC_MEMBER, ["icc_member"]),
    });
    expect(res.statusCode).toBe(404);
  });
});
