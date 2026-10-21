/**
 * CRM gap cluster 09 -- backend halves (DB-backed, HTTP round-trip).
 *
 *  - GAP-CRM-RTI-DETAIL-03 / GAP-CRM-SERVICE-REQUESTS-DETAIL-02: the detail GET can be
 *    asked (`?maskPii=true`) to mask PII even for a PII-read role, so a privileged
 *    viewer sees the clear value only through the audited POST /v1/crm/pii/reveal.
 *  - GAP-CRM-RTI-DETAIL-04: a Forward records WHERE the request came from
 *    (previousDepartmentRef) and WHEN (transferredAt), and the timeline note names both.
 *  - GAP-CRM-SERVICE-REQUESTS-03: the list takes `overdue=true` and `sort=dueAt`.
 *  - GAP-CRM-QUALIFICATION-FRAMEWORKS-04: business line is stored and matched in one
 *    canonical form (trim + lowercase), including rows saved before that rule.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// JWT_SECRET (and CRM_PII_KEY) are provided by this service's vitest config -- no literal here.
const SECRET = process.env.JWT_SECRET as string;

const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[]): Record<string, string> {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-c09" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const app = await buildApp();

async function inject(method: "GET" | "POST" | "PUT" | "PATCH", url: string, roles: string[], payload?: unknown) {
  return app.inject({ method, url, headers: headers(roles), ...(payload === undefined ? {} : { payload }) });
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`).catch(() => {});
  await scoped((tx) => tx`DELETE FROM crm.qualification_frameworks WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

// ---------------------------------------------------------------------------
// RTI
// ---------------------------------------------------------------------------

const PHONE = "9876543210";

async function createRti(): Promise<string> {
  const res = await inject("POST", "/v1/crm/rti", ["crm_admin"], {
    section: "s.6",
    departmentRef: "Ministry of Finance",
    applicantName: "Anil Sharma",
    applicantContact: PHONE,
    subject: "Property records",
    description: "Please furnish copies of assessment records.",
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP-CRM-RTI-DETAIL-03: ?maskPii=true on the RTI detail GET", () => {
  it("masks applicant name + contact for a PII-read role when asked, and never widens for crm_user", async () => {
    const id = await createRti();

    // Default behaviour is unchanged: the PII-read role gets the clear value.
    const clear = await inject("GET", `/v1/crm/rti/${id}`, ["crm_admin"]);
    expect(clear.json().data.applicantName).toBe("Anil Sharma");
    expect(clear.json().data.applicantContact).toBe(PHONE);

    // Opt-in: the same role now receives only the masked form.
    const masked = await inject("GET", `/v1/crm/rti/${id}?maskPii=true`, ["crm_admin"]);
    expect(masked.statusCode).toBe(200);
    expect(masked.json().data.applicantName).toBe("Anil S•••");
    expect(masked.json().data.applicantContact).toBe("******3210");
    expect(masked.body).not.toContain("Anil Sharma");
    expect(masked.body).not.toContain(PHONE);

    // `false` keeps the role-based behaviour.
    const off = await inject("GET", `/v1/crm/rti/${id}?maskPii=false`, ["crm_admin"]);
    expect(off.json().data.applicantContact).toBe(PHONE);

    // A role without PII access is masked whatever the flag says (it can only reduce).
    const user = await inject("GET", `/v1/crm/rti/${id}?maskPii=false`, ["crm_user"]);
    expect(user.json().data.applicantContact).toBe("******3210");
  });

  it("accepts the grievance detail's older ?pii=masked spelling of the same switch (one convention)", async () => {
    const id = await createRti();
    const masked = await inject("GET", `/v1/crm/rti/${id}?pii=masked`, ["crm_admin"]);
    expect(masked.statusCode).toBe(200);
    expect(masked.json().data.applicantContact).toBe("******3210");
    expect(masked.body).not.toContain(PHONE);
    // an unknown mode is still refused, not read as "no masking"
    const bad = await inject("GET", `/v1/crm/rti/${id}?pii=clear`, ["crm_admin"]);
    expect(bad.statusCode).toBe(400);
  });

  it("rejects an unrecognised maskPii value instead of silently ignoring it", async () => {
    const id = await createRti();
    const res = await inject("GET", `/v1/crm/rti/${id}?maskPii=maybe`, ["crm_admin"]);
    expect(res.statusCode).toBe(400);
  });

  it("the audited reveal still returns the clear value and writes the pii_reveal audit event", async () => {
    const id = await createRti();
    const res = await inject("POST", "/v1/crm/pii/reveal", ["crm_admin"], {
      resourceType: "rti",
      resourceId: id,
      field: "applicantContact",
      reason: "Need to send the response by phone",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe(PHONE);
    // The reveal domain event is enqueued through the outbox in the SAME transaction:
    // resource + field + reason, never the value.
    const domainRows = (await sqlClient`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT}::uuid AND topic = 'crm.pii.revealed'
      ORDER BY created_at DESC
    `) as unknown as Array<{ payload: Record<string, unknown> }>;
    const ev = domainRows.find((r) => (r.payload as { resourceId?: string }).resourceId === id);
    expect(ev).toBeTruthy();
    expect((ev!.payload as { field?: string }).field).toBe("applicantContact");
    expect(JSON.stringify(ev!.payload)).not.toContain(PHONE);
  });
});

describe("GAP-CRM-RTI-DETAIL-04: Forward records the previous department", () => {
  it("returns previousDepartmentRef + transferredAt on the forward response and the detail", async () => {
    const id = await createRti();

    const before = await inject("GET", `/v1/crm/rti/${id}`, ["crm_user"]);
    expect(before.json().data.previousDepartmentRef ?? null).toBeNull();
    expect(before.json().data.transferredAt ?? null).toBeNull();

    const fwd = await inject("PATCH", `/v1/crm/rti/${id}/forward`, ["crm_user"], { departmentRef: "Department of Revenue" });
    expect(fwd.statusCode).toBe(200);
    expect(fwd.json().data.previousDepartmentRef).toBe("Ministry of Finance");
    expect(fwd.json().data.departmentRef).toBe("Department of Revenue");

    const detail = (await inject("GET", `/v1/crm/rti/${id}`, ["crm_user"])).json().data;
    expect(detail.departmentRef).toBe("Department of Revenue");
    expect(detail.previousDepartmentRef).toBe("Ministry of Finance");
    expect(Number.isNaN(Date.parse(detail.transferredAt))).toBe(false);
  });

  it("a second hop keeps only the latest origin on the row, and the timeline names both ends", async () => {
    const id = await createRti();
    await inject("PATCH", `/v1/crm/rti/${id}/forward`, ["crm_user"], { departmentRef: "Department of Revenue" });
    await inject("PATCH", `/v1/crm/rti/${id}/forward`, ["crm_user"], { departmentRef: "Department of Posts" });

    const detail = (await inject("GET", `/v1/crm/rti/${id}`, ["crm_user"])).json().data;
    expect(detail.departmentRef).toBe("Department of Posts");
    expect(detail.previousDepartmentRef).toBe("Department of Revenue");

    const history = (await inject("GET", `/v1/crm/rti/${id}/history`, ["crm_user"])).json().data as Array<{ toStatus: string; note: string | null }>;
    const notes = history.filter((h) => h.toStatus === "TRANSFERRED").map((h) => h.note);
    expect(notes).toEqual([
      "Transferred from Ministry of Finance to Department of Revenue",
      "Transferred from Department of Revenue to Department of Posts",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------

async function createSr(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await inject("POST", "/v1/crm/service-requests", ["crm_admin"], {
    citizenName: "Asha Rao",
    citizenPhone: PHONE,
    citizenEmail: "citizen@example.in",
    serviceType: "certificate",
    subject: "Birth certificate",
    priority: "normal",
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-02: ?maskPii=true on the service-request detail GET", () => {
  it("masks phone + email for a PII-read role when asked; default stays clear", async () => {
    const id = await createSr();

    const clear = await inject("GET", `/v1/crm/service-requests/${id}`, ["crm_admin"]);
    expect(clear.json().data.citizenPhone).toBe(PHONE);

    const masked = await inject("GET", `/v1/crm/service-requests/${id}?maskPii=true`, ["crm_admin"]);
    expect(masked.statusCode).toBe(200);
    expect(masked.json().data.citizenPhone).toBe("******3210");
    expect(masked.json().data.citizenEmail).toBe("c***@example.in");
    expect(masked.body).not.toContain(PHONE);
    expect(masked.body).not.toContain("citizen@example.in");

    const user = await inject("GET", `/v1/crm/service-requests/${id}?maskPii=false`, ["crm_user"]);
    expect(user.json().data.citizenPhone).toBe("******3210");
  });

  it("accepts the grievance detail's older ?pii=masked spelling of the same switch (one convention)", async () => {
    const id = await createSr();
    const masked = await inject("GET", `/v1/crm/service-requests/${id}?pii=masked`, ["crm_admin"]);
    expect(masked.statusCode).toBe(200);
    expect(masked.json().data.citizenPhone).toBe("******3210");
    expect(masked.body).not.toContain(PHONE);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-03: overdue filter + dueAt sort", () => {
  const PAST_NEAR = "2020-01-02T00:00:00.000Z";
  const PAST_FAR = "2020-01-01T00:00:00.000Z";
  const FUTURE = "2999-01-01T00:00:00.000Z";

  it("overdue=true keeps only past-due WORKABLE requests; a resolved one and a future one are excluded", async () => {
    const overdueOpen = await createSr({ subject: "c09 overdue open", dueAt: PAST_NEAR });
    const overduePending = await createSr({ subject: "c09 overdue pending", dueAt: PAST_FAR });
    const future = await createSr({ subject: "c09 future", dueAt: FUTURE });
    const resolved = await createSr({ subject: "c09 resolved", dueAt: PAST_FAR });
    const noDue = await createSr({ subject: "c09 no due" });
    await inject("PATCH", `/v1/crm/service-requests/${overduePending}/status`, ["crm_admin"], { status: "pending", statusNote: "waiting" });
    await inject("PATCH", `/v1/crm/service-requests/${resolved}/status`, ["crm_admin"], { status: "resolved", resolution: "done" });

    const res = await inject("GET", "/v1/crm/service-requests?overdue=true&limit=200", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(overdueOpen);
    expect(ids).toContain(overduePending);
    expect(ids).not.toContain(future);
    expect(ids).not.toContain(resolved);
    expect(ids).not.toContain(noDue);
    // The per-status tiles follow the same filter and the total agrees with the rows.
    expect(res.json().meta.total).toBe(ids.length);
    expect(res.json().meta.statusCounts.resolved).toBe(0);

    // Without the flag the resolved/future rows are back.
    const all = await inject("GET", "/v1/crm/service-requests?limit=200", ["crm_admin"]);
    const allIds = (all.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(allIds).toEqual(expect.arrayContaining([future, resolved, noDue]));
  });

  it("sort=dueAt orders soonest due first, undated last", async () => {
    const res = await inject("GET", "/v1/crm/service-requests?sort=dueAt&limit=200", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ subject: string; dueAt: string | null }>;
    const subjects = rows.map((r) => r.subject);
    const iFar = subjects.indexOf("c09 overdue pending");
    const iNear = subjects.indexOf("c09 overdue open");
    const iFuture = subjects.indexOf("c09 future");
    const iNone = subjects.indexOf("c09 no due");
    expect(iFar).toBeGreaterThanOrEqual(0);
    expect(iFar).toBeLessThan(iNear);
    expect(iNear).toBeLessThan(iFuture);
    expect(iFuture).toBeLessThan(iNone);
  });

  it("the audited CSV export honours overdue=true exactly like the list", async () => {
    const res = await inject(
      "GET",
      `/v1/crm/service-requests/export?overdue=true&purpose=${encodeURIComponent("Weekly overdue review for the desk")}`,
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("c09 overdue open");
    expect(res.body).toContain("c09 overdue pending");
    expect(res.body).not.toContain("c09 future");
    expect(res.body).not.toContain("c09 resolved");
    expect(res.body).not.toContain("c09 no due");
  });

  it("rejects an unknown sort key", async () => {
    const res = await inject("GET", "/v1/crm/service-requests?sort=citizenName", ["crm_admin"]);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Qualification frameworks
// ---------------------------------------------------------------------------

const QUESTION = { prompt: "Has an approved budget?", answerType: "bool", weight: 100, outcomeRule: { whenTrue: 100, whenFalse: 0 } };

describe("GAP-CRM-QUALIFICATION-FRAMEWORKS-04: one canonical business-line form", () => {
  it("stores 'Government ' as 'government' on create and on update", async () => {
    const created = await inject("POST", "/v1/crm/qualification-frameworks", ["crm_admin"], {
      name: "Govt fit", businessLine: "  Government ", questions: [QUESTION],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.businessLine).toBe("government");

    const updated = await inject("PUT", `/v1/crm/qualification-frameworks/${created.json().data.id}`, ["crm_admin"], {
      businessLine: " PSU ",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.businessLine).toBe("psu");
  });

  it("matches the list filter case- and whitespace-insensitively, including a legacy non-canonical row", async () => {
    const legacyId = randomUUID();
    // A row written before the canonical-form rule: mixed case + trailing space.
    await scoped((tx) => tx`
      INSERT INTO crm.qualification_frameworks (id, tenant_id, name, business_line, active, created_by, updated_by)
      VALUES (${legacyId}, ${TENANT}, 'Legacy fit', 'Enterprise ', true, ${ACTOR}, ${ACTOR})`);

    for (const q of ["enterprise", "Enterprise", "%20ENTERPRISE%20"]) {
      const res = await inject("GET", `/v1/crm/qualification-frameworks?businessLine=${q}`, ["crm_user"]);
      expect(res.statusCode).toBe(200);
      const ids = (res.json().data as Array<{ id: string }>).map((f) => f.id);
      expect(ids).toContain(legacyId);
    }
    // And it is not returned for a different line.
    const other = await inject("GET", "/v1/crm/qualification-frameworks?businessLine=smb", ["crm_user"]);
    expect((other.json().data as Array<{ id: string }>).map((f) => f.id)).not.toContain(legacyId);
  });
});
