/**
 * GAP2-PROJECTS-SCHEMES-MONEY-04 — scheme money unit parity.
 *
 * The LIST (GET /v1/projects/schemes) and DETAIL (GET /v1/projects/schemes/:id)
 * endpoints must return money in the SAME unit: bigint MINOR units (paise) as a
 * string. Previously the list returned whole rupees (minorToAmount) while the
 * detail returned paise — a 100x hazard. This asserts the list's
 * totalAllocation/releasedAmount are the raw paise values (equal to the detail's
 * totalOutlayMinor/releasedMinor), not divided by 100.
 *
 * DB-backed against the real app (buildApp) + real Postgres (RLS).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "5c040000-dead-4000-8000-00000000c004";
const ACTOR = "5c040000-dead-4000-8000-0000000ac704";
const SCHEME = randomUUID();
const TOTAL_OUTLAY_MINOR = 100000000n; // ₹10,00,000
const RELEASED_MINOR = 60000000n; // ₹6,00,000

function authHeader(roles: string[] = ["project_manager"]) {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-money-04" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clean();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(projectSchemes).values({
      id: SCHEME, tenantId: TENANT, code: "MONEY04", name: "Money Unit Parity Scheme",
      type: "css", fundingPattern: "100",
      totalOutlayMinor: TOTAL_OUTLAY_MINOR, releasedMinor: RELEASED_MINOR,
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});
afterAll(async () => { await clean(); await app.close(); });

describe("GAP2-PROJECTS-SCHEMES-MONEY-04 — list money is paise, matching detail", () => {
  it("the list returns totalAllocation/releasedAmount as paise strings (not whole rupees)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects/schemes?limit=50", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const list = Array.isArray(body) ? body : body.data;
    const row = list.find((r: { id: string }) => r.id === SCHEME);
    expect(row).toBeTruthy();
    // Paise, as a string — NOT minorToAmount (which would be "1000000" rupees).
    expect(String(row.totalAllocation)).toBe(TOTAL_OUTLAY_MINOR.toString());
    expect(String(row.releasedAmount)).toBe(RELEASED_MINOR.toString());
  });

  it("list and detail agree on the money unit for the same scheme", async () => {
    const listRes = await app.inject({ method: "GET", url: "/v1/projects/schemes?limit=50", headers: authHeader() });
    const detailRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${SCHEME}`, headers: authHeader() });
    const listBody = listRes.json();
    const list = Array.isArray(listBody) ? listBody : listBody.data;
    const listRow = list.find((r: { id: string }) => r.id === SCHEME);
    const detail = detailRes.json();
    expect(String(listRow.totalAllocation)).toBe(String(detail.totalOutlayMinor));
    expect(String(listRow.releasedAmount)).toBe(String(detail.releasedMinor));
  });
});
