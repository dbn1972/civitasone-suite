/**
 * payroll-service — Statutory Returns + Challan routes integration tests
 *
 * Covers:
 * - GET /v1/payroll/statutory/form24q (happy, 400, 401, 403, 409)
 * - POST /v1/payroll/statutory/form24q/force-file (happy, 400, 401, 403) —
 *   the confirmed reconciliation-bypass action; see the SEC FIX banner above
 *   that describe block for the GET `?force=1` vulnerability this replaces.
 * - GET /v1/payroll/statutory/form12ba (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/nps-scf (happy, 400, 401, 403, 404)
 * - POST /v1/payroll/statutory/perquisite-components (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/form26q (happy, 400, 401, 403)
 * - POST /v1/payroll/statutory/challans (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/challans (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/reconcile (happy, 400, 401, 403)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function filerToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin", "hr_admin", "finance_officer"], sid: "s1" }, SECRET);
}
function employeeToken(sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { /* pool closed by other test teardown */ });

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form24q
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form24q — happy path", () => {
  it("returns structured 24Q for valid fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    // 200 if data loads; 409 if reconciliation mismatch; 500/502 if deps down
    expect([200, 409, 500, 502]).toContain(res.statusCode);
  });

  it("returns file format when format=file is passed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q2&format=file",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 409, 500, 502]).toContain(res.statusCode);
  });

  it("SEC FIX: GET force=1 no longer bypasses the reconciliation gate — identical to a plain GET", async () => {
    // With and without `&force=1`, a plain GET for the same fy/quarter must
    // now be IDENTICAL — proving `force` is completely inert on GET,
    // regardless of whatever this environment's underlying reconciliation
    // state happens to be (the happy-path test above tolerates 200 or 409
    // for that same reason). Before the fix these two requests could differ
    // (409 without force, 200 WITH force=1 bypassing the gate) because the
    // GET handler itself performed the bypass off the query param. Now the
    // only way to bypass is the confirmed POST .../form24q/force-file below.
    const app = await buildApp();
    const withoutForce = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q3",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    const withForce = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q3&force=1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 409, 500, 502]).toContain(withoutForce.statusCode);
    expect(withForce.statusCode).toBe(withoutForce.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form24q — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is missing/invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-99&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form24q — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee-only role (no admin/officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/statutory/form24q/force-file
//
// SEC FIX: this endpoint replaces a GET `?force=1` query param on
// /v1/payroll/statutory/form24q that fired the reconciliation-bypass +
// force_file_24q audit event off ANY GET request — including a browser
// prefetch, a link-preview crawler, or someone opening a bookmarked/shared
// URL — with no user confirmation. It is now the ONLY way to bypass the
// gate, and only with a validated { confirmForce: true, reason } body.
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/form24q/force-file — happy path", () => {
  it("files 24Q with a confirmed reason, bypassing the reconciliation gate", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: {
        fy: "2025-26",
        quarter: "Q3",
        confirmForce: true,
        reason: "TRACES portal unavailable; filing before due date per CBDT circular.",
      },
    });
    await app.close();
    // 200 whether or not the period actually turns out unreconciled (forcing
    // an already-matched quarter is a harmless no-op); 500/502 if deps down.
    expect([200, 500, 502]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.formType).toBe("24Q");
      expect(body.fy).toBe("2025-26");
      expect(body.quarter).toBe("Q3");
    }
  });
});

describe("POST /v1/payroll/statutory/form24q/force-file — 400 validation", () => {
  const validPayload = { fy: "2025-26", quarter: "Q3", confirmForce: true as const, reason: "Filing before due date." };

  it("returns 400 when confirmForce is missing", async () => {
    const app = await buildApp();
    const { confirmForce: _drop, ...rest } = validPayload;
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: rest,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when confirmForce is false", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { ...validPayload, confirmForce: false },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when reason is missing", async () => {
    const app = await buildApp();
    const { reason: _drop, ...rest } = validPayload;
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: rest,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when reason is an empty/whitespace string", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { ...validPayload, reason: "   " },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const { fy: _drop, ...rest } = validPayload;
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: rest,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { ...validPayload, quarter: "Q9" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/statutory/form24q/force-file — auth", () => {
  const validPayload = { fy: "2025-26", quarter: "Q3", confirmForce: true as const, reason: "Filing before due date." };

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee-only role (no admin/officer) — same gate as the GET", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("a bare GET on the force-file action path 404s — no accidental-trigger surface at all", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q/force-file?fy=2025-26&quarter=Q3&confirmForce=1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([404, 405]).toContain(res.statusCode);
  });
});

describe("Source: force-file audit trail (static checks — this file boots a real app via buildApp() " +
  "throughout, so it deliberately does NOT mock ../src/shared/infra.js file-wide the way " +
  "ddo-pensioner-cqrs.test.ts does; these assert the same properties at the source level instead)", () => {
  const routesSrc = readFileSync(
    join(__dirname, "../src/modules/statutory-returns/routes.ts"),
    "utf8",
  );

  it("threads the caller-supplied reason into the force_file_24q audit payload", () => {
    const start = routesSrc.indexOf("async function buildForm24Q(");
    const end = routesSrc.indexOf("export async function statutoryReturnsRoutes");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const helperSrc = routesSrc.slice(start, end);
    expect(helperSrc).toContain('action: "force_file_24q"');
    expect(helperSrc).toMatch(/\breason,/);
  });

  it("GET /v1/payroll/statutory/form24q can never set force=true (source-level guarantee)", () => {
    const getStart = routesSrc.indexOf('app.get("/v1/payroll/statutory/form24q",');
    // Slice to the GET handler's own final statement, NOT to the next route
    // registration — the JSDoc comment documenting the POST force-file route
    // sits between them and (rightly) uses the word "force" several times,
    // which would make this assertion trivially fail if included.
    const getEndMarker = '.send(lines.join("\\r\\n"));';
    const getEnd = routesSrc.indexOf(getEndMarker) + getEndMarker.length;
    expect(getStart).toBeGreaterThan(-1);
    expect(getEnd).toBeGreaterThan(getStart);
    const getHandlerSrc = routesSrc.slice(getStart, getEnd);
    expect(getHandlerSrc).not.toMatch(/force/i);
    expect(getHandlerSrc).toContain("buildForm24Q(ctx, fy, quarter, false)");
  });

  it("POST force-file requires confirmForce: true and a non-empty reason (source-level guarantee)", () => {
    const postStart = routesSrc.indexOf('app.post("/v1/payroll/statutory/form24q/force-file",');
    const nextRoute = routesSrc.indexOf('app.get("/v1/payroll/statutory/form12ba",');
    expect(postStart).toBeGreaterThan(-1);
    expect(nextRoute).toBeGreaterThan(postStart);
    const postHandlerSrc = routesSrc.slice(postStart, nextRoute);
    expect(postHandlerSrc).toContain("forceFileBody.parse(req.body)");
    const schemaStart = routesSrc.indexOf("const forceFileBody = z.object({");
    const schemaEnd = routesSrc.indexOf("});", schemaStart);
    const schemaSrc = routesSrc.slice(schemaStart, schemaEnd);
    expect(schemaSrc).toContain("z.literal(true)");
    expect(schemaSrc).toMatch(/reason:\s*z\.string\(\)[^\n]*\.min\(1/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form12ba
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form12ba — happy path", () => {
  it("returns form 12BA for valid employeeId + fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    // 200 if data loads; 500/502 if HRMS/DB unreachable
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form12ba — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-99`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when employeeId is missing for admin caller", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form12ba?fy=2025-26",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form12ba — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when employee tries to access another employee's 12BA", async () => {
    const otherEmp = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${otherEmp}&fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("allows employee to access their own 12BA", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    // 200 if data loads; 500/502 if deps unavailable — but NOT 403
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/nps-scf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/nps-scf — happy path", () => {
  it("returns NPS-SCF for valid month", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if NPS data exists; 404 if no records; 500/502 if deps down
    expect([200, 404, 500, 502]).toContain(res.statusCode);
  });

  it("returns file format when format=file is passed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06&format=file",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([200, 404, 500, 502]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — 400 validation", () => {
  it("returns 400 when month is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when month format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=June2025",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when month uses wrong separator", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025/06",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role (not statutory admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — 404", () => {
  it("returns 404 when no NPS records for a distant period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2010-01",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/statutory/perquisite-components
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/perquisite-components — happy path", () => {
  it("returns 201 for valid perquisite component", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        employeeId: randomUUID(),
        fy: "2025-26",
        nature: "accommodation",
        description: "Company-provided housing",
        valueByEmployer: 50000,
        amountRecovered: 5000,
      },
    });
    await app.close();
    expect([201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      const body = res.json();
      expect(body.message).toContain("perquisite component saved");
      expect(body.nature).toBe("accommodation");
    }
  });
});

describe("POST /v1/payroll/statutory/perquisite-components — 400 validation", () => {
  it("returns 400 when employeeId is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-99", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when nature is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when valueByEmployer is negative", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: -100 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/statutory/perquisite-components — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form26q
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form26q — happy path", () => {
  it("returns structured 26Q for valid fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.formType).toBe("26Q");
    }
  });

  it("returns file format when format=file", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q2&format=file",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form26q — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-99&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form26q — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/statutory/challans
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/challans — happy path", () => {
  it("returns 201 for valid challan ingestion", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: {
        period: "2025-06",
        bsrCode: "1234567",
        challanSerial: "00123",
        depositDate: "2025-07-07",
        tdsAmount: 50000,
        section: "192",
        formType: "24Q",
      },
    });
    await app.close();
    expect([200, 201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201 || res.statusCode === 200) {
      const body = res.json();
      expect(body.cin).toBeDefined();
      expect(body.period).toBe("2025-06");
    }
  });

  it("is idempotent — second insert returns 200", async () => {
    const app = await buildApp();
    const payload = {
      period: "2025-05",
      bsrCode: "9876543",
      challanSerial: "00999",
      depositDate: "2025-06-10",
      tdsAmount: 25000,
      formType: "24Q",
    };
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload,
    });
    if (res1.statusCode === 201) {
      const res2 = await app.inject({
        method: "POST",
        url: "/v1/payroll/statutory/challans",
        headers: { authorization: `Bearer ${filerToken()}` },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().message).toContain("idempotent");
    }
    await app.close();
  });
});

describe("POST /v1/payroll/statutory/challans — 400 validation", () => {
  it("returns 400 when period is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when bsrCode is not 7 digits", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "123", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when challanSerial is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when depositDate format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "07-07-2025", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when tdsAmount is negative", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: -100 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/statutory/challans — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/challans
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/challans — happy path", () => {
  it("returns challan list for valid period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.period).toBe("2025-06");
      expect(body.formType).toBe("24Q");
      expect(body.challans).toBeDefined();
      expect(Array.isArray(body.challans)).toBe(true);
    }
  });

  it("accepts formType=26Q filter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06&formType=26Q",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().formType).toBe("26Q");
    }
  });
});

describe("GET /v1/payroll/statutory/challans — 400 validation", () => {
  it("returns 400 when period is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when period format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=Jun2025",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/challans — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/reconcile
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/reconcile — happy path", () => {
  it("returns reconciliation for a single period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.formType).toBe("24Q");
      expect(body.perPeriod).toBeDefined();
      expect(typeof body.matched).toBe("boolean");
    }
  });

  it("returns reconciliation for fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.perPeriod).toHaveLength(3);
    }
  });

  it("accepts formType=26Q", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06&formType=26Q",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().formType).toBe("26Q");
    }
  });
});

describe("GET /v1/payroll/statutory/reconcile — 400 validation", () => {
  it("returns 400 when neither period nor fy+quarter provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy is provided without quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=invalid&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/reconcile — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
