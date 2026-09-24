/**
 * Disciplinary/vigilance case ownership — real-DB regression (no mocks).
 *
 * HIGH finding: the named inquiry officer field was captured on every
 * disciplinary case but never enforced -- any actor holding a
 * disciplinary-adjacent role (hr_officer/hr_admin/super_admin) could act on
 * ANY case via disciplinary/routes.ts's mutating routes, not just the one
 * case they were actually assigned to. Fixed via routes.ts's
 * assertCaseOwner(): the acting ctx.actorId must equal either the case's
 * inquiry_officer_id or its created_by. Both are PROVEN actor-id-space
 * columns (traced via f3-consumer.ts's real write path, not assumed -- see
 * assertCaseOwner's own doc comment in routes.ts), so this is a direct id
 * comparison, never resolveEmployeeForActor (which would compare against the
 * wrong id space entirely for this table).
 *
 * Real DB (no mocks), following this codebase's own established precedent
 * (coi-declarations-identity-scope-real-db.test.ts): cases are seeded
 * directly via drizzle so each test starts from a known
 * status/inquiry-officer/creator without depending on the async F3 write
 * pipeline (already covered separately by disciplinary/f3-consumer.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerF3_disciplinary_Consumers } from "../modules/disciplinary/f3-consumer.js";
import { hrmsDisciplinaryCases } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

// disciplinaryRoutes' mutating endpoints only PUBLISH (publishF3Write); the
// row is actually written by this consumer, which f3-leftover-register.ts
// wires into the standalone worker process (worker.ts) -- buildApp() (the
// HTTP app under test here) never registers it. Register it directly here
// so the one test below that re-reads after a write exercises the whole
// path instead of racing an F3 consumer that was never listening -- same
// pattern department-routes.test.ts uses for its own F3-backed routes.
registerF3_disciplinary_Consumers(queue);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant per run: every query here is tenant-scoped, so this gives
// hermetic isolation from any other data in the DB (including other
// worktrees/agents running against a shared instance) with no explicit
// cleanup needed -- same convention as the COI/apar identity-resolution tests.
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-disc-ownership" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

// Actor ids (JWT `sub`). For hrms_disciplinary_cases these are ALSO the
// exact id space created_by/inquiry_officer_id are stored in (see
// assertCaseOwner's doc comment in routes.ts) -- no hrms_employees
// resolution is involved for this table, unlike APAR/medical-claims/COI.
const CREATOR_ACTOR = randomUUID();        // opened the case; owns it
const OFFICER_A_ACTOR = randomUUID();      // assigned inquiry officer
const OFFICER_B_ACTOR = randomUUID();      // disciplinary-adjacent role, NOT assigned
const OTHER_HR_ADMIN_ACTOR = randomUUID(); // hr_admin, neither creator nor officer

let app: FastifyInstance;

async function seedCase(opts: {
  status: string;
  createdBy: string;
  inquiryOfficerId?: string | null;
  proceedingType?: "minor" | "major";
}): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDisciplinaryCases).values({
    id, tenantId: TENANT, employeeId: randomUUID(),
    caseNo: `DC-${id.slice(0, 8)}`,
    proceedingType: opts.proceedingType ?? "major",
    status: opts.status,
    allegation: "Alleged misconduct under the CCS (CCA) Rules",
    ...(opts.inquiryOfficerId !== undefined ? { inquiryOfficerId: opts.inquiryOfficerId } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST .../charge-memo — pre-inquiry stage: only the case's creator qualifies", () => {
  it("an hr_officer who neither created the case nor is its inquiry officer is rejected (403 NOT_CASE_OWNER)", async () => {
    const caseId = await seedCase({ status: "opened", createdBy: CREATOR_ACTOR });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/charge-memo`,
      headers: auth(OFFICER_B_ACTOR, ["hr_officer"]),
      payload: { chargeMemoRef: "CM/1", chargeMemoDate: "2026-01-05" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_CASE_OWNER");
  });

  it("the case's own creator CAN issue the charge memo, and the write actually lands", async () => {
    const caseId = await seedCase({ status: "opened", createdBy: CREATOR_ACTOR });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/charge-memo`,
      headers: auth(CREATOR_ACTOR, ["hr_officer"]),
      payload: { chargeMemoRef: "CM/2", chargeMemoDate: "2026-01-05" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("charge_memo_issued");

    // publishF3Write is fire-and-forget (MemoryQueue.publish() schedules
    // delivery via setTimeout(0) and returns immediately) -- drain() before
    // re-reading so this confirms the write actually landed, not just that
    // the route accepted it.
    await (queue as unknown as MemoryQueue).drain();
    const read = await app.inject({
      method: "GET", url: `/v1/hrms/disciplinary-cases/${caseId}`,
      headers: auth(CREATOR_ACTOR, ["hr_officer"]),
    });
    expect(read.json().status).toBe("charge_memo_issued");
  });

  it("an hr_admin who is neither the creator nor the inquiry officer is ALSO rejected — no blanket admin override", async () => {
    const caseId = await seedCase({ status: "opened", createdBy: CREATOR_ACTOR });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/charge-memo`,
      headers: auth(OTHER_HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { chargeMemoRef: "CM/3", chargeMemoDate: "2026-01-05" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_CASE_OWNER");
  });
});

describe("POST .../finding — post-appointment stage: the assigned inquiry officer also qualifies", () => {
  it("a different hr_officer (not the assigned officer, not the creator) is rejected", async () => {
    const caseId = await seedCase({
      status: "inquiry_appointed", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/finding`,
      headers: auth(OFFICER_B_ACTOR, ["hr_officer"]),
      payload: { finding: "guilty", findingDate: "2026-02-01" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_CASE_OWNER");
  });

  it("the assigned inquiry officer (who is NOT the case's creator) CAN record the finding", async () => {
    const caseId = await seedCase({
      status: "inquiry_appointed", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/finding`,
      headers: auth(OFFICER_A_ACTOR, ["hr_officer"]),
      payload: { finding: "guilty", findingDate: "2026-02-01" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("finding_recorded");
  });

  it("the case's creator can ALSO record the finding — either clause independently satisfies ownership", async () => {
    const caseId = await seedCase({
      status: "inquiry_appointed", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/finding`,
      headers: auth(CREATOR_ACTOR, ["hr_officer"]),
      payload: { finding: "not_guilty", findingDate: "2026-02-01" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("when no inquiry officer id was ever linked (name-only appointment), only the creator qualifies", async () => {
    const caseId = await seedCase({
      status: "inquiry_appointed", createdBy: CREATOR_ACTOR, inquiryOfficerId: null,
    });
    const rejected = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/finding`,
      headers: auth(OFFICER_B_ACTOR, ["hr_officer"]),
      payload: { finding: "guilty", findingDate: "2026-02-01" },
    });
    expect(rejected.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/finding`,
      headers: auth(CREATOR_ACTOR, ["hr_officer"]),
      payload: { finding: "guilty", findingDate: "2026-02-01" },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe("POST .../penalty and .../close — ownership applies uniformly across the mutating routes", () => {
  it("penalty: a non-owning hr_admin is rejected (403), the creator succeeds (200)", async () => {
    const caseId = await seedCase({
      status: "finding_recorded", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const rejected = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/penalty`,
      headers: auth(OTHER_HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { penaltyType: "censure", penaltyDate: "2026-03-01" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().code).toBe("NOT_CASE_OWNER");

    const allowed = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/penalty`,
      headers: auth(CREATOR_ACTOR, ["hr_admin"]),
      payload: { penaltyType: "censure", penaltyDate: "2026-03-01" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("close: the assigned inquiry officer (not the creator) can also close the case", async () => {
    const caseId = await seedCase({
      status: "penalty_imposed", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const rejected = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/close`,
      headers: auth(OFFICER_B_ACTOR, ["hr_admin"]),
      payload: {},
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().code).toBe("NOT_CASE_OWNER");

    const allowed = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/close`,
      headers: auth(OFFICER_A_ACTOR, ["hr_admin"]),
      payload: {},
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe("POST .../disciplinary/:id/submit-approval — ownership applies here too (bypasses transition())", () => {
  it("a non-owning actor is rejected before the eOffice command is even queued", async () => {
    const caseId = await seedCase({
      status: "finding_recorded", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary/${caseId}/submit-approval`,
      headers: auth(OTHER_HR_ADMIN_ACTOR, ["hr_admin"]),
      payload: { penaltyType: "censure", penaltyDate: "2026-03-01" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_CASE_OWNER");
  });

  it("the assigned inquiry officer CAN submit the proposed penalty for eOffice approval", async () => {
    const caseId = await seedCase({
      status: "finding_recorded", createdBy: CREATOR_ACTOR, inquiryOfficerId: OFFICER_A_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/disciplinary/${caseId}/submit-approval`,
      headers: auth(OFFICER_A_ACTOR, ["hr_admin"]),
      payload: { penaltyType: "censure", penaltyDate: "2026-03-01" },
    });
    expect(r.statusCode).toBe(202);
  });
});
