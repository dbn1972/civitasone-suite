/**
 * CAP-089 — compliance control library + evidence + computed posture.
 * Proves the posture score is DERIVED from persisted control pass/fail, not
 * hardcoded, and that VAPT reports are honestly persisted (not fabricated).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllF3Consumers } from "./helpers/register-all-f3-consumers.js";
import { computePosture } from "../src/modules/security-compliance/posture.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Per-run random tenants keep these DB-backed tests isolated from prior runs
// and from other test files sharing this Postgres (the suite is not safe to run
// against a single shared DB with fixed tenant ids).
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function token(actorId = ACTOR, tenantId = TENANT, roles = ["security_admin"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "s89" }, SECRET, 3600);
}
function auth(tenantId?: string, roles?: string[]) {
  return { authorization: `Bearer ${token(ACTOR, tenantId, roles)}`, "x-tenant-id": tenantId ?? TENANT };
}

let app: FastifyInstance;
beforeAll(async () => {
  // F3 CONSUMER WIRING — same gap as tests/security-incident.test.ts and
  // tests/doc-governance-routes.test.ts: this suite's app comes from
  // src/app.ts alone, so every write here (seed, control PATCH, evidence,
  // VAPT ingest) publishes a command that nothing ever applies without this.
  registerAllF3Consumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

// The F3 consumer applies writes asynchronously — poll after a write instead
// of assuming it has landed by the time the next request is injected. Mirrors
// the pattern in tests/security-incident.test.ts / integration-settings-ssrf.test.ts.
async function settle(ms = 25): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
async function waitForControlsSeeded(headers: Record<string, string>, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls", headers });
    if (res.json().data.length > 0) return res;
    await settle();
  }
  throw new Error("compliance controls never landed — F3 consumer not draining");
}
async function waitForPosture(headers: Record<string, string>, predicate: (data: { overallScore: number | null; passed: number; failed: number }) => boolean, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/posture", headers });
    if (predicate(res.json().data)) return res;
    await settle();
  }
  throw new Error("posture never reflected the expected write — F3 consumer not draining");
}

describe("posture (pure)", () => {
  it("returns null score when nothing is testable", () => {
    expect(computePosture([]).overallScore).toBeNull();
    expect(computePosture([{ framework: "SOC2", status: "not_tested" }]).overallScore).toBeNull();
    expect(computePosture([{ framework: "SOC2", status: "not_applicable" }]).overallScore).toBeNull();
  });
  it("derives score from pass/fail ratio and excludes N/A + not_tested from denominator", () => {
    const r = computePosture([
      { framework: "SOC2", status: "pass" },
      { framework: "SOC2", status: "pass" },
      { framework: "SOC2", status: "fail" },
      { framework: "SOC2", status: "not_tested" },
      { framework: "DPDP", status: "not_applicable" },
    ]);
    expect(r.overallScore).toBe(67); // 2/3
    expect(r.passed).toBe(2); expect(r.failed).toBe(1); expect(r.notTested).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.byFramework.SOC2.score).toBe(67);
  });
});

describe("control library (integration)", () => {
  let controlId: string;

  it("seeds a baseline catalogue as not_tested", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/security/compliance/controls/seed", headers: auth() });
    expect(res.statusCode).toBe(202);
    const seeded = await waitForControlsSeeded(auth());
    expect(seeded.json().data.length).toBeGreaterThan(0);
    const seededCount = seeded.json().data.length;

    // re-seed is idempotent (no duplicates) — count is unchanged once both
    // async seed commands have landed.
    const again = await app.inject({ method: "POST", url: "/v1/admin/security/compliance/controls/seed", headers: auth() });
    expect(again.statusCode).toBe(202);
    await (queue as any).drain?.();
    const after = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls", headers: auth() });
    expect(after.json().data.length).toBe(seededCount);
  });

  it("lists controls and filters by framework; soc2 view serves real data", async () => {
    const all = await waitForControlsSeeded(auth());
    expect(all.statusCode).toBe(200);
    expect(all.json().data.length).toBeGreaterThan(0);
    const dpdp = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls?framework=DPDP", headers: auth() });
    expect(dpdp.json().data.every((c: { framework: string }) => c.framework === "DPDP")).toBe(true);
    const soc2 = await app.inject({ method: "GET", url: "/v1/admin/security/soc2/controls", headers: auth() });
    expect(soc2.json().meta.note).toMatch(/not hardcoded/);
    controlId = soc2.json().data[0].id;
  });

  it("posture starts null (all seeded controls untested)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/posture", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.overallScore).toBeNull();
    expect(res.json().data.complete).toBe(false);
  });

  it("recording a pass moves the posture off null (proves it is computed)", async () => {
    const patch = await app.inject({
      method: "PATCH", url: `/v1/admin/security/compliance/controls/${controlId}`,
      headers: auth(), payload: { status: "pass", owner: "ciso@gov.in" },
    });
    expect(patch.statusCode).toBe(202);
    const res = await waitForPosture(auth(), (d) => d.passed >= 1);
    expect(res.json().data.overallScore).toBe(100); // 1 pass / 1 tested
    expect(res.json().data.passed).toBe(1);
  });

  it("recording a fail lowers the computed score", async () => {
    await waitForControlsSeeded(auth());
    const all = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls?framework=SOC2", headers: auth() });
    const other = all.json().data.find((c: { id: string }) => c.id !== controlId).id;
    await app.inject({ method: "PATCH", url: `/v1/admin/security/compliance/controls/${other}`, headers: auth(), payload: { status: "fail" } });
    const res = await waitForPosture(auth(), (d) => d.failed >= 1);
    expect(res.json().data.overallScore).toBe(50); // 1 pass / 2 tested
  });

  it("attaches and lists evidence", async () => {
    const add = await app.inject({
      method: "POST", url: `/v1/admin/security/compliance/controls/${controlId}/evidence`,
      headers: auth(), payload: { kind: "audit_event", reference: "evt-123", note: "RLS enforcement verified" },
    });
    expect(add.statusCode).toBe(202);
    await (queue as any).drain?.();
    const list = await app.inject({ method: "GET", url: `/v1/admin/security/compliance/controls/${controlId}/evidence`, headers: auth() });
    expect(list.json().data.length).toBe(1);
    expect(list.json().data[0].kind).toBe("audit_event");
  });

  it("evidence on a missing control 404s", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/security/compliance/controls/00000000-0000-4000-8000-000000000000/evidence`,
      headers: auth(), payload: { kind: "note", note: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("VAPT ingestion (integration)", () => {
  it("honestly persists an uploaded external report", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/security/vapt/reports", headers: auth(),
      payload: { targetServices: ["finance-service"], scanType: "full", critical: 1, high: 2, medium: 3, low: 4 },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().data.id as string;
    await (queue as any).drain?.();
    const list = await app.inject({ method: "GET", url: "/v1/admin/security/vapt/reports", headers: auth() });
    expect(list.json().data.length).toBeGreaterThan(0);
    const one = await app.inject({ method: "GET", url: `/v1/admin/security/vapt/reports/${id}`, headers: auth() });
    expect(one.json().data.critical).toBe(1);
    expect(one.json().data.findingsCount).toBe(10);
  });
});

// Finding 2 (PR #171 review) — posture.openIncidents must reflect the live
// admin.sec_incidents table (CAP-090), not the dead legacy admin.security_incidents.
describe("posture openIncidents reflects live sec_incidents", () => {
  const CHECKER = randomUUID();
  function authAs(actorId: string) {
    return { authorization: `Bearer ${token(actorId, TENANT, ["security_admin"])}`, "x-tenant-id": TENANT };
  }
  async function openCount(): Promise<number> {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/posture", headers: auth() });
    return res.json().data.openIncidents as number;
  }

  it("counts an open incident and drops it on close", async () => {
    const before = await openCount();

    const create = await app.inject({
      method: "POST", url: "/v1/admin/security-incidents", headers: auth(),
      payload: { title: "posture open incident", severity: "high" },
    });
    expect(create.statusCode).toBe(202);
    const incidentId = create.json().data.id;
    await (queue as any).drain?.();

    expect(await openCount()).toBe(before + 1);

    // walk to resolved, then a different admin closes it (maker-checker).
    // Each transition's route re-reads the incident's current status
    // synchronously before accepting, so the previous step's write must have
    // landed first — drain after every step.
    for (const toStatus of ["triaged", "contained", "resolved"]) {
      const t = await app.inject({
        method: "POST", url: `/v1/admin/security-incidents/${incidentId}/transition`,
        headers: auth(), payload: { toStatus },
      });
      expect(t.statusCode).toBe(202);
      await (queue as any).drain?.();
    }
    const close = await app.inject({
      method: "POST", url: `/v1/admin/security-incidents/${incidentId}/close`,
      headers: authAs(CHECKER), payload: { note: "closed" },
    });
    expect(close.statusCode).toBe(202);
    await (queue as any).drain?.();

    expect(await openCount()).toBe(before);
  });
});

describe("access + isolation", () => {
  it("401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/posture" });
    expect(res.statusCode).toBe(401);
  });
  it("403 without an admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls", headers: auth(TENANT, ["viewer"]) });
    expect(res.statusCode).toBe(403);
  });
  it("400 on bad vapt payload", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/security/vapt/scan", headers: auth(), payload: { targetServices: [] } });
    expect(res.statusCode).toBe(400);
  });
  it("does not leak controls across tenants (RLS)", async () => {
    const other = await app.inject({ method: "GET", url: "/v1/admin/security/compliance/controls", headers: auth(OTHER) });
    expect(other.json().data.length).toBe(0);
  });
});
