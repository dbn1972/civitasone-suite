/**
 * SVC-083/085/086/090 — route integration tests.
 * Covers: maker-checker rejection+success, RLS cross-tenant 404, refund approval,
 * issuance→public verify, consent-gated discovery, and outbox emission.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000015";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000015";
const MAKER   = "11111111-0000-4000-8000-000000000015";
const CHECKER = "22222222-0000-4000-8000-000000000015";
const SERVICE_ID = "33333333-0000-4000-8000-000000000015";

function tok(tenant: string, actor: string, roles = ["citizen_admin", "citizen_officer", "super_admin"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-gaps" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT_A }; }

async function outboxTopics(): Promise<string[]> {
  const rows = await sqlClient`SELECT topic FROM _outbox.messages WHERE tenant_id = ${TENANT_A}`;
  return rows.map((r: { topic: string }) => r.topic);
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ═══════════════════════════ SVC-083 Eligibility ════════════════════════════
describe("SVC-083 eligibility rule-set maker-checker + evaluate", () => {
  let ruleSetId: string;

  it("creates a draft rule set", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/eligibility/rule-sets", headers: hdr(tok(TENANT_A, MAKER)),
      payload: {
        serviceId: SERVICE_ID, name: "Pension eligibility",
        rules: [
          { id: "age", attribute: "age", op: "gte", value: 60, effect: "disqualify", label: "60+" },
          { id: "proof", attribute: "income_proof", op: "exists", effect: "refer", label: "needs proof" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    ruleSetId = res.json().id;
    expect(res.json().status).toBe("draft");
  });

  it("submit records the maker", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/eligibility/rule-sets/${ruleSetId}/submit`, headers: hdr(tok(TENANT_A, MAKER)) });
    expect(res.statusCode).toBe(200);
  });

  it("MAKER-CHECKER: publish by the submitter is rejected 403", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/eligibility/rule-sets/${ruleSetId}/publish`, headers: hdr(tok(TENANT_A, MAKER)) });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("publish by a different checker succeeds + emits outbox event", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/eligibility/rule-sets/${ruleSetId}/publish`, headers: hdr(tok(TENANT_A, CHECKER)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.eligibility.ruleset_published");
  });

  it("published rule set is immutable (re-publish 409)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/eligibility/rule-sets/${ruleSetId}/publish`, headers: hdr(tok(TENANT_A, CHECKER)) });
    expect(res.statusCode).toBe(409);
  });

  it("RLS: tenant B cannot read tenant A rule set (404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/eligibility/rule-sets/${ruleSetId}`,
      headers: { authorization: `Bearer ${tok(TENANT_B, CHECKER)}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });

  it("evaluate → refer_manual queues a manual review, then decision resolves it", async () => {
    const ev = await app.inject({
      method: "POST", url: "/v1/citizen/eligibility/evaluate", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { serviceId: SERVICE_ID, subject: { age: 70 } }, // age ok, income_proof missing → refer
    });
    expect(ev.statusCode).toBe(200);
    expect(ev.json().outcome).toBe("refer_manual");
    const evalId = ev.json().id;

    const queue = await app.inject({ method: "GET", url: "/v1/citizen/eligibility/manual-review", headers: hdr(tok(TENANT_A, CHECKER)) });
    expect(queue.json().data.some((e: { id: string }) => e.id === evalId)).toBe(true);

    const decide = await app.inject({
      method: "POST", url: `/v1/citizen/eligibility/evaluations/${evalId}/decision`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { decision: "eligible", note: "manually verified" },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json().reviewStatus).toBe("decided");
  });

  it("evaluate → not_eligible when disqualified", async () => {
    const ev = await app.inject({
      method: "POST", url: "/v1/citizen/eligibility/evaluate", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { serviceId: SERVICE_ID, subject: { age: 40, income_proof: "x" } },
    });
    expect(ev.json().outcome).toBe("not_eligible");
  });
});

// ═══════════════════════════ SVC-085 Fee & Payment ══════════════════════════
describe("SVC-085 fee schedule, payment, receipt, refund maker-checker", () => {
  const APP_ID = "44444444-0000-4000-8000-000000000015";
  let scheduleId: string;
  let paymentId: string;

  it("creates a fee schedule with an exemption", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/fees/schedules", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { serviceId: SERVICE_ID, name: "Trade licence fee", baseAmount: 500, exemptions: [{ id: "bpl", attribute: "bpl", op: "eq", value: true, kind: "waive" }] },
    });
    expect(res.statusCode).toBe(201);
    scheduleId = res.json().id;
  });

  it("computes fee with exemption applied", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/fees/compute", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { applicationId: APP_ID, scheduleId, subject: { bpl: true } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBe(0);
    expect(res.json().exemptionApplied).toBe("bpl");
  });

  it("online intent with NO gateway stays pending (honest, not fake success)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/payments/intent", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { applicationId: APP_ID, scheduleId, subject: {} },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("pending");
    expect(res.json().gatewayConfigured).toBe(false);
    expect(res.json().amount).toBe(500);
  });

  it("offline payment records + issues a receipt and emits receipt.issued", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/payments/offline", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { applicationId: APP_ID, scheduleId, subject: {} },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("offline_recorded");
    expect(res.json().receiptNo).toMatch(/^RCT-\d{4}-\d{8}$/);
    paymentId = res.json().id;
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.receipt.issued");
  });

  it("MAKER-CHECKER refund: approve by requester rejected, by other approved", async () => {
    const reqRes = await app.inject({
      method: "POST", url: `/v1/citizen/payments/${paymentId}/refunds`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: { amount: 500, reason: "overcharge" },
    });
    expect(reqRes.statusCode).toBe(201);
    const refundId = reqRes.json().id;

    const selfApprove = await app.inject({
      method: "POST", url: `/v1/citizen/refunds/${refundId}/decision`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: { decision: "approve" },
    });
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().code).toBe("MAKER_CHECKER");

    const approve = await app.inject({
      method: "POST", url: `/v1/citizen/refunds/${refundId}/decision`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { decision: "approve" },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("approved");

    const pay = await app.inject({ method: "GET", url: `/v1/citizen/payments/${paymentId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
    expect(pay.json().status).toBe("refunded");
  });
});

// ═══════════════════════════ SVC-086 Issuance ═══════════════════════════════
describe("SVC-086 issuance maker-checker, gapless numbering, public verify", () => {
  let certId1: string; let certId2: string; let token1: string;

  async function requestCert(): Promise<string> {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/certificates/requests", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { certType: "birth", subject: { name: "Asha" }, payload: { name: "Asha", place: "Delhi" }, validTo: "2030-01-01" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  it("MAKER-CHECKER: approve by requester rejected 403", async () => {
    certId1 = await requestCert();
    const res = await app.inject({ method: "POST", url: `/v1/citizen/certificates/${certId1}/approve`, headers: hdr(tok(TENANT_A, MAKER)) });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("approve by checker allocates cert no + verify token + signature; gapless sequence", async () => {
    const a1 = await app.inject({ method: "POST", url: `/v1/citizen/certificates/${certId1}/approve`, headers: hdr(tok(TENANT_A, CHECKER)) });
    expect(a1.statusCode).toBe(200);
    const b1 = a1.json();
    expect(b1.certNo).toMatch(/^BIRTH-\d{4}-\d{6}$/);
    expect(b1.verifyToken).toBeTruthy();
    expect(b1.signature).toBeTruthy();
    token1 = b1.verifyToken;

    certId2 = await requestCert();
    const a2 = await app.inject({ method: "POST", url: `/v1/citizen/certificates/${certId2}/approve`, headers: hdr(tok(TENANT_A, CHECKER)) });
    const seq1 = Number(b1.certNo.split("-")[2]);
    const seq2 = Number(a2.json().certNo.split("-")[2]);
    expect(seq2).toBe(seq1 + 1); // gapless, consecutive
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.certificate.issued");
  });

  it("public verify by token (no auth) → valid", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/citizen/certificates/verify/${token1}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().validity).toBe("valid");
    expect(res.json().certNo).toMatch(/^BIRTH-/);
  });

  it("revoke → public verify reports invalid", async () => {
    const rev = await app.inject({
      method: "POST", url: `/v1/citizen/certificates/${certId1}/revoke`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { action: "revoke", reason: "fraud" },
    });
    expect(rev.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: `/v1/citizen/certificates/verify/${token1}` });
    expect(res.json().validity).toBe("invalid");
  });

  it("unknown verify token → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/certificates/verify/deadbeefdeadbeef" });
    expect(res.statusCode).toBe(404);
  });

  it("RLS: tenant B cannot read tenant A certificate (404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/certificates/${certId2}`,
      headers: { authorization: `Bearer ${tok(TENANT_B, CHECKER)}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });

  it("amend + renew re-seal the certificate", async () => {
    const amend = await app.inject({
      method: "POST", url: `/v1/citizen/certificates/${certId2}/amend`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { payload: { name: "Asha K", place: "Delhi" }, note: "name correction" },
    });
    expect(amend.statusCode).toBe(200);
    expect(amend.json().status).toBe("amended");
    const renew = await app.inject({
      method: "POST", url: `/v1/citizen/certificates/${certId2}/renew`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { validTo: "2035-01-01" },
    });
    expect(renew.statusCode).toBe(200);
    expect(renew.json().status).toBe("renewed");
  });
});

// ═══════════════════════════ SVC-090 Discovery ══════════════════════════════
describe("SVC-090 consent-gated proactive discovery", () => {
  const CITIZEN = "55555555-0000-4000-8000-000000000015";

  it("run WITHOUT consent → 403 CONSENT_REQUIRED (no processing)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/discovery/run", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { citizenId: CITIZEN, profile: { age: 70 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CONSENT_REQUIRED");
  });

  it("grant consent, then run → matches likely-eligible services + notifies", async () => {
    const grant = await app.inject({
      method: "POST", url: "/v1/citizen/discovery/consent", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { citizenId: CITIZEN },
    });
    expect(grant.statusCode).toBe(201);

    const run = await app.inject({
      method: "POST", url: "/v1/citizen/discovery/run", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { citizenId: CITIZEN, profile: { age: 70, income_proof: "x" } },
    });
    expect(run.statusCode).toBe(200);
    // Published pension rule set (age>=60 + income_proof exists) → eligible
    expect(run.json().notified).toBeGreaterThanOrEqual(1);
    const topics = await outboxTopics();
    expect(topics).toContain("notification.send");
    expect(topics).toContain("citizen.discovery.service_discovered");

    const matches = await app.inject({
      method: "GET", url: `/v1/citizen/discovery/matches?citizenId=${CITIZEN}`, headers: hdr(tok(TENANT_A, CHECKER)),
    });
    expect(matches.json().data.length).toBeGreaterThanOrEqual(1);
    const matchId = matches.json().data[0].id;

    const enrol = await app.inject({
      method: "POST", url: `/v1/citizen/discovery/matches/${matchId}/enrol`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { serviceType: "pension" },
    });
    expect(enrol.statusCode).toBe(201);
    expect(enrol.json().applicationId).toBeTruthy();
  });

  it("revoke consent then run → 403 again", async () => {
    await app.inject({
      method: "POST", url: "/v1/citizen/discovery/consent/revoke", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { citizenId: CITIZEN },
    });
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/discovery/run", headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { citizenId: CITIZEN, profile: { age: 70 } },
    });
    expect(res.statusCode).toBe(403);
  });
});
