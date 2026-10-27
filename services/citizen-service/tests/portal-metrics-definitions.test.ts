/**
 * GAP-CITIZEN-PORTAL-05: pins WHAT "active" and "resolved" mean in
 * GET /v1/citizen/portal/metrics, so the public KPI cards cannot drift:
 *   activeRequests      = submitted + under_review + in_progress (open work)
 *   resolvedThisMonth   = status "resolved" only (not rejected / cancelled) whose
 *                         resolved_at falls in the CURRENT INDIAN-CALENDAR month
 *                         (month boundary is midnight IST, not UTC)
 *   avgResolutionDays   = mean(resolved_at - created_at) over those same rows
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { periodStart } from "../src/modules/helpdesk/sla.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CITIZEN = randomUUID();
const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen_officer"], sid: "s" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
});

const MIN = 60_000;
let app: FastifyInstance;

async function seed(status: string, createdAt: Date, resolvedAt: Date | null) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO requests.citizen_requests
      (id, tenant_id, citizen_id, subject, description, status, resolved_at, created_at, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${CITIZEN}, 's', 'd', ${status}, ${resolvedAt ? resolvedAt.toISOString() : null}::timestamptz, ${createdAt.toISOString()}::timestamptz, ${ACTOR}, ${ACTOR})`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  const istMonthStart = periodStart("mtd");
  const now = new Date();
  for (const s of ["submitted", "under_review", "in_progress"]) await seed(s, now, null);
  // terminal-but-not-resolved states are neither active nor resolved
  await seed("rejected", now, now);
  await seed("cancelled", now, now);
  // resolved 30 minutes after midnight IST on the 1st: inside the IST month, but BEFORE the UTC month start
  // (the UTC-based boundary used to drop it for the first 5.5 hours of every month).
  await seed("resolved", new Date(istMonthStart.getTime() - 2 * 86_400_000), new Date(istMonthStart.getTime() + 30 * MIN));
  // resolved 30 minutes BEFORE midnight IST on the 1st: belongs to last month
  await seed("resolved", new Date(istMonthStart.getTime() - 3 * 86_400_000), new Date(istMonthStart.getTime() - 30 * MIN));
}, 30000);

afterAll(async () => {
  await sqlClient
    .begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`DELETE FROM requests.citizen_requests WHERE tenant_id = ${TENANT}`;
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/citizen/portal/metrics definitions (GAP-CITIZEN-PORTAL-05)", () => {
  it("active = submitted + under_review + in_progress only", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/portal/metrics", headers: hdr() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.activeRequests).toBe(3);
  });

  it("resolved-this-month counts only resolved rows inside the current IST month (not rejected/cancelled, not last month)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/portal/metrics", headers: hdr() });
    expect(res.json().data.resolvedThisMonth).toBe(1);
    // that one row took exactly 2 days + 30 min => 2.0 days at one-decimal rounding
    expect(res.json().data.avgResolutionDays).toBe(2);
  });
});
