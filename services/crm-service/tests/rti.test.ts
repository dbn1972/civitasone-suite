/**
 * RTI Act 2005 module — route handler tests.
 *
 * Covers:
 *   T1  POST  /v1/crm/rti            create → 201, referenceNo assigned
 *   T2  GET   /v1/crm/rti            list   → 200, row present
 *   T3  PATCH /v1/crm/rti/:id/forward  → 200, status TRANSFERRED
 *   T4  PATCH /v1/crm/rti/:id/respond  → 200, status RESPONDED
 *   T5  PATCH /v1/crm/rti/:id/first-appeal → 200, status FIRST_APPEAL
 *   T6  POST  /v1/crm/rti  — missing required field → 400
 *   T7  GET   /v1/crm/rti  — no JWT   → 401
 *
 * Writes are direct SQL (not CQRS), so no queue draining is needed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000089";
const ACTOR  = "cccccccc-3333-4000-8000-000000000089";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-rti" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function cleanup() {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`.catch(
        () => {},
      );
    })
    .catch(() => {});
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_BODY = {
  section: "s.6",
  departmentRef: "Ministry of Finance",
  applicantName: "Rajan Kumar",
  applicantContact: "9876543210",
  subject: "Status of PM-KISAN disbursement for FY 2024-25",
  description:
    "Kindly provide details of PM-KISAN disbursements made in district Patna during FY 2024-25, including beneficiary counts and total amount.",
  feePaid: true,
  feeAmount: 10,
};

async function createRti(payload = VALID_BODY) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/rti",
    headers: headers(),
    payload,
  });
  await app.close();
  return res;
}

// ---------------------------------------------------------------------------
// T1 — create
// ---------------------------------------------------------------------------

describe("POST /v1/crm/rti", () => {
  it("T1: creates an RTI request → 201 with referenceNo and dueAt", async () => {
    const res = await createRti();

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data).toMatchObject({
      status: "RECEIVED",
      section: "s.6",
      applicantName: "Rajan Kumar",
    });
    expect(typeof body.data.referenceNo).toBe("string");
    expect((body.data.referenceNo as string).startsWith("RTI/")).toBe(true);
    // due_at should be ~30 days from now
    const dueAt = new Date(body.data.dueAt as string);
    const diffDays = Math.round(
      (dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("T6: missing required field (section) → 400", async () => {
    const { section: _dropped, ...noSection } = VALID_BODY;
    const res = await createRti(noSection as typeof VALID_BODY);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T2 — list
// ---------------------------------------------------------------------------

describe("GET /v1/crm/rti", () => {
  it("T2: lists RTI requests → 200, seeded row present", async () => {
    // Ensure at least one row exists
    await createRti();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/rti",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; meta: { total: number } }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(typeof body.meta.total).toBe("number");
  });

  it("T7: returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/rti",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T3 — forward
// ---------------------------------------------------------------------------

describe("PATCH /v1/crm/rti/:id/forward", () => {
  it("T3: forwards RTI to a new department → 200, status TRANSFERRED", async () => {
    const created = await createRti();
    const { data } = created.json<{ data: { id: string } }>();
    const id = data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/rti/${id}/forward`,
      headers: headers(),
      payload: { departmentRef: "Department of Revenue" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data.status).toBe("TRANSFERRED");
    expect(body.data.departmentRef).toBe("Department of Revenue");
  });
});

// ---------------------------------------------------------------------------
// T4 — respond
// ---------------------------------------------------------------------------

describe("PATCH /v1/crm/rti/:id/respond", () => {
  it("T4: responds to RTI → 200, status RESPONDED, respondedAt set", async () => {
    const created = await createRti();
    const { data } = created.json<{ data: { id: string } }>();
    const id = data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/rti/${id}/respond`,
      headers: headers(),
      payload: {
        responseText:
          "The requested information is enclosed herewith per RTI Act 2005.",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data.status).toBe("RESPONDED");
    expect(body.data.respondedAt).toBeTruthy();
    expect(body.data.responseText).toContain("enclosed herewith");
  });
});

// ---------------------------------------------------------------------------
// T5 — first-appeal
// ---------------------------------------------------------------------------

describe("PATCH /v1/crm/rti/:id/first-appeal", () => {
  it("T5: raises first appeal from RESPONDED → 200, status FIRST_APPEAL, firstAppealDueAt set", async () => {
    // Create and respond first
    const created = await createRti();
    const { data: createdData } = created.json<{ data: { id: string } }>();
    const id = createdData.id;

    const app1 = await buildApp();
    await app1.inject({
      method: "PATCH",
      url: `/v1/crm/rti/${id}/respond`,
      headers: headers(),
      payload: { responseText: "Response provided." },
    });
    await app1.close();

    // Now raise first appeal
    const app2 = await buildApp();
    const res = await app2.inject({
      method: "PATCH",
      url: `/v1/crm/rti/${id}/first-appeal`,
      headers: headers(),
    });
    await app2.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data.status).toBe("FIRST_APPEAL");
    expect(body.data.firstAppealDueAt).toBeTruthy();
    // firstAppealDueAt should be ~30 days from now
    const appealDue = new Date(body.data.firstAppealDueAt as string);
    const diffDays = Math.round(
      (appealDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBeGreaterThanOrEqual(29);
  });

  it("T5b: first-appeal from RECEIVED state → 422", async () => {
    const created = await createRti();
    const { data } = created.json<{ data: { id: string } }>();
    const id = data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/rti/${id}/first-appeal`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });
});
