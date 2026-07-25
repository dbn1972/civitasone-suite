/**
 * Manpower Planning — route-path coverage (SVC-003).
 * Exercises the draft-edit, manual roster, list, reject and error paths not
 * covered by the happy-path approval flow in manpower-integration.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = randomUUID();
const MAKER   = randomUUID();
const CHECKER = randomUUID();
const UNIT    = randomUUID();

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("draft editing + listing", () => {
  it("creates, edits a draft's strengths (recomputing vacancy) and lists it", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)),
      payload: { planYear: 2028, unitId: UNIT, cadre: "Section Officer", requiredStrength: 10, sanctionedStrength: 6, filledStrength: 2 } });
    expect(res.statusCode).toBe(201);
    const planId = res.json().id;

    // vacancy 6−2 = 4 initially
    res = await app.inject({ method: "GET", url: `/v1/hrms/manpower/plans/${planId}`, headers: bare(tok(MAKER)) });
    expect(res.json().data.vacancy).toBe(4);

    // bump sanctioned to 9 → vacancy 7
    res = await app.inject({ method: "PATCH", url: `/v1/hrms/manpower/plans/${planId}`, headers: auth(tok(MAKER)),
      payload: { sanctionedStrength: 9, remarks: "revised sanction" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.vacancy).toBe(7);

    // list includes the plan with computed vacancy
    res = await app.inject({ method: "GET", url: "/v1/hrms/manpower/plans", headers: bare(tok(MAKER)) });
    expect(res.statusCode).toBe(200);
    const found = (res.json().data as Array<{ id: string; vacancy: number }>).find((p) => p.id === planId);
    expect(found?.vacancy).toBe(7);
  });

  it("rejects a duplicate plan for the same unit/cadre/year", async () => {
    const payload = { planYear: 2029, unitId: UNIT, cadre: "Duplicate Cadre", sanctionedStrength: 5 };
    const first = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)), payload });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)), payload });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_PLAN");
  });

  it("cannot edit a plan once it is no longer a draft", async () => {
    const c = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)),
      payload: { planYear: 2030, unitId: UNIT, cadre: "Locked Cadre", sanctionedStrength: 3 } });
    const planId = c.json().id;
    await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/submit`, headers: bare(tok(MAKER)) });
    const res = await app.inject({ method: "PATCH", url: `/v1/hrms/manpower/plans/${planId}`, headers: auth(tok(MAKER)), payload: { sanctionedStrength: 4 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("manual roster + reject path", () => {
  it("accepts manual category-wise roster inputs, then rejects the plan (maker-checker)", async () => {
    const c = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)),
      payload: { planYear: 2031, unitId: UNIT, cadre: "Draftsman", sanctionedStrength: 12, filledStrength: 2 } });
    const planId = c.json().id;

    // manual roster override on the draft
    let res = await app.inject({ method: "PUT", url: `/v1/hrms/manpower/plans/${planId}/roster`, headers: auth(tok(MAKER)),
      payload: { entries: [ { category: "SC", reservedCount: 2 }, { category: "OBC", reservedCount: 3 }, { category: "UR", reservedCount: 5 } ] } });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as unknown[]).length).toBe(3);

    await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/submit`, headers: bare(tok(MAKER)) });

    // creator cannot reject their own plan
    res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/reject`, headers: bare(tok(MAKER)) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");

    // a different checker rejects it
    res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/reject`, headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
  });
});

describe("error paths", () => {
  it("404s for an unknown plan and unknown requisition", async () => {
    const missing = randomUUID();
    const p = await app.inject({ method: "GET", url: `/v1/hrms/manpower/plans/${missing}`, headers: bare(tok(MAKER)) });
    expect(p.statusCode).toBe(404);
    const r = await app.inject({ method: "POST", url: `/v1/hrms/manpower/requisitions/${missing}/advertise`, headers: auth(tok(MAKER)), payload: { advertisementRef: "X" } });
    expect(r.statusCode).toBe(404);
  });

  it("400s on an invalid create payload", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)), payload: { planYear: 2030 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("lists requisitions for a tenant (empty is valid)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/manpower/requisitions", headers: bare(tok(MAKER)) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});
