/**
 * estab-service — CSMOP security / validation NEGATIVE route suite.
 *
 * Route-level (app.inject, HTTP) proofs that the eOffice abuse / error paths
 * are correctly rejected by the CSMOP gates in
 *   src/modules/files/routes.ts  +  src/modules/operators/eligibility.ts
 *
 * Gates exercised (all synchronous, asserted at the HTTP boundary):
 *   1. unauthenticated read                       → 401
 *   2. under-cleared classified view (isAccessAllowed)
 *                                                 → 403 FORBIDDEN
 *   3. sufficiently-cleared classified view       → 200 (control)
 *   4. public file viewable at low clearance       → 200 (control)
 *   5. move to a NON-operator (isMoveAllowed)      → 422 NOT_AN_OPERATOR
 *   6. move to an under-cleared operator           → 422 INSUFFICIENT_CLEARANCE
 *   7. detach receipt without reason (zod)         → 400 VALIDATION_FAILED
 *   8. reopen file without reason (zod)            → 400 VALIDATION_FAILED
 *
 * Cache note: isAccessAllowed / tenantHasOperators cache per
 * (tenant, "operator", key) for ~60s. To avoid stale-cache bleed each case
 * uses a FRESH random tenant (randomUUID) and enrols operators by direct
 * db.insert BEFORE the request, so the first getOrLoad reads the live DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { estabFileOperator } from "../src/modules/operators/schema.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function mint(sub: string, roles: string[], tid: string): string {
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({
    sub, iss: "civitasone-dev", tid, tenantId: tid, sid: "t",
    email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600,
  });
  const s = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

const CT = { "content-type": "application/json" };
const OFFICER_ROLES = ["estab_officer"];

// Track every tenant we touch so afterAll can clean only our rows.
const tenants: string[] = [];
function freshTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

/** Enrol an active eOffice operator (direct insert, pre-request). */
async function enrolOperator(
  tenantId: string,
  employeeId: string,
  clearanceLevel: number,
  active = true,
): Promise<void> {
  await db.insert(estabFileOperator).values({
    tenantId,
    employeeId,
    division: "ADMIN",
    deskRole: "dealing_hand",
    clearanceLevel,
    active,
    assignedBy: employeeId,
    createdBy: employeeId,
    updatedBy: employeeId,
  });
}

/** Insert a file row directly with a given classification / status. */
async function insertFile(
  tenantId: string,
  id: string,
  actor: string,
  classification: string,
  status = "active",
): Promise<void> {
  await db.insert(estabFiles).values({
    id,
    tenantId,
    fileNo: `F/${id.slice(0, 8)}`,
    subject: "Test subject",
    dept: "ADMIN",
    classification,
    currentWith: actor,
    status,
    createdBy: actor,
    updatedBy: actor,
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  if (tenants.length > 0) {
    await db.delete(estabFiles).where(inArray(estabFiles.tenantId, tenants));
    await db.delete(estabFileOperator).where(inArray(estabFileOperator.tenantId, tenants));
  }
  await app.close();
  await sqlClient.end();
});

// ── 1. Unauthenticated read ─────────────────────────────────────────────────
describe("CSMOP — auth gate", () => {
  it("GET /v1/estab/files/:id with no Authorization header → 401", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });
});

// ── 2 & 3 & 4. Classification view gate (isAccessAllowed) ───────────────────
describe("CSMOP — classification view gate (isAccessAllowed)", () => {
  it("under-cleared officer viewing a 'secret' file → 403 FORBIDDEN", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const fileId = randomUUID();
    await enrolOperator(T, actor, 1 /* public */, true);
    await insertFile(T, fileId, actor, "secret");

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${fileId}`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("sufficiently-cleared officer (secret) viewing a 'secret' file → 200", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const fileId = randomUUID();
    await enrolOperator(T, actor, 3 /* secret */, true);
    await insertFile(T, fileId, actor, "secret");

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${fileId}`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().classification).toBe("secret");
  });

  it("low-clearance officer viewing a 'public' file → 200 (public always allowed)", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const fileId = randomUUID();
    await enrolOperator(T, actor, 1 /* public */, true);
    await insertFile(T, fileId, actor, "public");

    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${fileId}`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().classification).toBe("public");
  });
});

// ── 5 & 6. Move gate (isMoveAllowed → clearance) ────────────────────────────
describe("CSMOP — move gate (isMoveAllowed / clearance)", () => {
  it("move to a NON-operator (tenant has adopted operators) → 422 NOT_AN_OPERATOR", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const fileId = randomUUID();
    // tenant has at least one active operator → adoption is ON
    await enrolOperator(T, actor, 3, true);
    await insertFile(T, fileId, actor, "public", "active");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/files/${fileId}/move`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}`, ...CT },
      payload: { toOfficer: randomUUID() /* NOT enrolled */ },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NOT_AN_OPERATOR");
  });

  it("move to an active but under-cleared operator (secret file) → 422 INSUFFICIENT_CLEARANCE", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const target = randomUUID();
    const fileId = randomUUID();
    await enrolOperator(T, actor, 3 /* secret */, true);
    await enrolOperator(T, target, 1 /* public — under-cleared */, true);
    await insertFile(T, fileId, actor, "secret", "active");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/files/${fileId}/move`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}`, ...CT },
      payload: { toOfficer: target },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INSUFFICIENT_CLEARANCE");
  });
});

// ── 7 & 8. Zod validation gates ─────────────────────────────────────────────
describe("CSMOP — input validation gate (zod)", () => {
  it("detach receipt without a reason → 400 VALIDATION_FAILED", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/inward/detach",
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}`, ...CT },
      payload: { inwardId: randomUUID() /* reason missing */ },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("reopen file without a reason → 400 VALIDATION_FAILED", async () => {
    const T = freshTenant();
    const actor = randomUUID();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/estab/files/${randomUUID()}/reopen`,
      headers: { authorization: `Bearer ${mint(actor, OFFICER_ROLES, T)}`, ...CT },
      payload: {} /* reason missing */,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
