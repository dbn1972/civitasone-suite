/**
 * F1 — Server-side PII masking + audited reveal (DB-backed).
 *
 * These tests prove the SERVER is the authority for PII redaction on the
 * citizen-facing CRM reads, and that the audited reveal path returns the clear
 * value only to privileged callers while writing a `pii_reveal` audit event
 * that carries no PII value.
 *
 * They fail on the old code: before F1, grievances/rti/service-requests/
 * onboarding GETs returned the clear phone/email/name/kyc reference to every
 * CRM role, and there was no /v1/crm/pii/reveal endpoint.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string, sub = randomUUID()): Record<string, string> {
  const jwt = signToken({ sub, tid, roles, sid: "sess-f1-pii" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const PHONE = "9876543210";
const EMAIL = "citizen@example.in";

// ──────────────────────────────────────────────────────────────────────────
// F1-01 Grievances
// ──────────────────────────────────────────────────────────────────────────
describe("F1-01 grievances mask citizenPhone/citizenEmail server-side", () => {
  async function createGrievance(tid: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/grievances",
      headers: authHeaders(["crm_admin"], tid),
      payload: {
        citizenName: "Asha Rao",
        citizenPhone: PHONE,
        citizenEmail: EMAIL,
        category: "water",
        subject: "No supply",
        priority: "normal",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }

  it("crm_user gets masked values on detail; raw never appears in the body", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);

    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/grievances/${id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().data;
    expect(row.citizenPhone).toBe("******3210");
    expect(row.citizenEmail).toBe("c***@example.in");
    // The raw value must never leak anywhere in the response body.
    expect(res.body).not.toContain(PHONE);
    expect(res.body).not.toContain(EMAIL);
  });

  it("crm_admin gets the clear values on detail", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);

    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/grievances/${id}`,
      headers: authHeaders(["crm_admin"], tid),
    });
    const row = res.json().data;
    expect(row.citizenPhone).toBe(PHONE);
    expect(row.citizenEmail).toBe(EMAIL);
  });

  it("list masks for crm_user and reveals for crm_admin", async () => {
    const tid = randomUUID();
    await createGrievance(tid);

    const masked = await app.inject({
      method: "GET",
      url: "/v1/crm/grievances",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(masked.body).not.toContain(PHONE);
    expect(masked.json().data[0].citizenPhone).toBe("******3210");

    const clear = await app.inject({
      method: "GET",
      url: "/v1/crm/grievances",
      headers: authHeaders(["crm_admin"], tid),
    });
    expect(clear.json().data[0].citizenPhone).toBe(PHONE);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F1-02 RTI
// ──────────────────────────────────────────────────────────────────────────
describe("F1-02 rti mask applicantName (partial) + applicantContact", () => {
  async function createRti(tid: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_admin"], tid),
      payload: {
        section: "s.6",
        departmentRef: "REVENUE",
        applicantName: "Anil Sharma",
        applicantContact: PHONE,
        subject: "Property records",
        description: "Please furnish copies of assessment records.",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }

  it("crm_user sees partially masked name + masked contact; raw absent", async () => {
    const tid = randomUUID();
    const id = await createRti(tid);

    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    const row = res.json().data;
    expect(row.applicantName).toBe("Anil S•••");
    expect(row.applicantContact).toBe("******3210");
    expect(res.body).not.toContain("Anil Sharma");
    expect(res.body).not.toContain(PHONE);
  });

  it("crm_admin sees the clear name + contact", async () => {
    const tid = randomUUID();
    const id = await createRti(tid);
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/rti/${id}`,
      headers: authHeaders(["crm_admin"], tid),
    });
    const row = res.json().data;
    expect(row.applicantName).toBe("Anil Sharma");
    expect(row.applicantContact).toBe(PHONE);
  });

  it("list masks applicantName for crm_user", async () => {
    const tid = randomUUID();
    await createRti(tid);
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/rti",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(res.json().data[0].applicantName).toBe("Anil S•••");
    expect(res.body).not.toContain("Anil Sharma");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F1-04 Service requests
// ──────────────────────────────────────────────────────────────────────────
describe("F1-04 service-requests mask citizen phone/email server-side", () => {
  async function createSr(tid: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: authHeaders(["crm_admin"], tid),
      payload: {
        citizenName: "Asha Rao",
        citizenPhone: PHONE,
        citizenEmail: EMAIL,
        serviceType: "certificate",
        subject: "Birth certificate",
        priority: "normal",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }

  it("crm_user gets masked detail; raw absent", async () => {
    const tid = randomUUID();
    const id = await createSr(tid);
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/service-requests/${id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    const row = res.json().data;
    expect(row.citizenPhone).toBe("******3210");
    expect(row.citizenEmail).toBe("c***@example.in");
    expect(res.body).not.toContain(PHONE);
    expect(res.body).not.toContain(EMAIL);
  });

  it("crm_admin gets clear detail", async () => {
    const tid = randomUUID();
    const id = await createSr(tid);
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/service-requests/${id}`,
      headers: authHeaders(["crm_admin"], tid),
    });
    const row = res.json().data;
    expect(row.citizenPhone).toBe(PHONE);
    expect(row.citizenEmail).toBe(EMAIL);
  });

  it("list masks phone for crm_user, clear for crm_admin", async () => {
    const tid = randomUUID();
    await createSr(tid);
    const masked = await app.inject({
      method: "GET",
      url: "/v1/crm/service-requests",
      headers: authHeaders(["crm_user"], tid),
    });
    expect(masked.json().data[0].citizenPhone).toBe("******3210");
    expect(masked.body).not.toContain(PHONE);

    const clear = await app.inject({
      method: "GET",
      url: "/v1/crm/service-requests",
      headers: authHeaders(["crm_admin"], tid),
    });
    expect(clear.json().data[0].citizenPhone).toBe(PHONE);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F1-03 Onboarding kycReference
// ──────────────────────────────────────────────────────────────────────────
describe("F1-03 onboarding mask kycReference (last 4) except KYC approvers", () => {
  const KYC_REF = "KYCPROV-ABCD1234";

  async function seedCase(tid: string): Promise<string> {
    const id = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await tx`
        INSERT INTO crm.onboarding_cases
          (id, tenant_id, deal_id, account_id, stage, kyc_status, kyc_reference, created_by, updated_by)
        VALUES
          (${id}::uuid, ${tid}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
           'verification', 'submitted', ${KYC_REF}, ${randomUUID()}::uuid, ${randomUUID()}::uuid)
      `;
    });
    return id;
  }

  it("crm_user sees only the last 4 of kycReference; raw absent", async () => {
    const tid = randomUUID();
    const id = await seedCase(tid);
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/onboarding-cases/${id}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kycReference).toBe("••••1234");
    expect(res.body).not.toContain(KYC_REF);
  });

  it("crm_admin (KYC approver) sees the clear kycReference", async () => {
    const tid = randomUUID();
    const id = await seedCase(tid);
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/onboarding-cases/${id}`,
      headers: authHeaders(["crm_admin"], tid),
    });
    expect(res.json().kycReference).toBe(KYC_REF);
  });

  it("list masks kycReference for crm_user", async () => {
    const tid = randomUUID();
    await seedCase(tid);
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/onboarding-cases",
      headers: authHeaders(["crm_user"], tid),
    });
    const row = res.json().data.find((r: { kycReference: string | null }) => r.kycReference);
    expect(row.kycReference).toBe("••••1234");
    expect(res.body).not.toContain(KYC_REF);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F1-05 Audited reveal
// ──────────────────────────────────────────────────────────────────────────
describe("F1-05 POST /v1/crm/pii/reveal (audited)", () => {
  async function createGrievance(tid: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/grievances",
      headers: authHeaders(["crm_admin"], tid),
      payload: {
        citizenName: "Asha Rao",
        citizenPhone: PHONE,
        citizenEmail: EMAIL,
        category: "water",
        subject: "No supply",
        priority: "normal",
      },
    });
    return res.json().data.id as string;
  }

  it("401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      payload: { resourceType: "grievance", resourceId: randomUUID(), field: "citizenPhone", reason: "service follow up" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a crm_user (outside PII-read roles)", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      headers: authHeaders(["crm_user"], tid),
      payload: { resourceType: "grievance", resourceId: id, field: "citizenPhone", reason: "service follow up" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("422 when the reason is too short (<10 chars)", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      headers: authHeaders(["crm_admin"], tid),
      payload: { resourceType: "grievance", resourceId: id, field: "citizenPhone", reason: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("422 for a non-revealable field", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      headers: authHeaders(["crm_admin"], tid),
      payload: { resourceType: "grievance", resourceId: id, field: "subject", reason: "service follow up" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FIELD_NOT_REVEALABLE");
  });

  it("admin reveal returns the clear value AND writes a pii_reveal audit event with no PII value", async () => {
    const tid = randomUUID();
    const id = await createGrievance(tid);
    const reason = "citizen called to chase their grievance";
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      headers: authHeaders(["crm_admin"], tid),
      payload: { resourceType: "grievance", resourceId: id, field: "citizenPhone", reason },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe(PHONE);

    // The audit event is enqueued through the outbox in the SAME transaction.
    const auditRows = (await sqlClient`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${tid}::uuid
        AND topic = 'audit.event.record'
        AND payload->>'action' = 'pii_reveal'
      ORDER BY created_at DESC
    `) as unknown as Array<{ payload: Record<string, unknown> }>;
    // At least one pii_reveal audit for this tenant exists.
    expect(auditRows.length).toBeGreaterThan(0);
    // The clear PII value must never be in any audit/outbox payload.
    for (const r of auditRows) {
      expect(JSON.stringify(r.payload)).not.toContain(PHONE);
    }
    // The reveal domain event (crm.pii.revealed) carries field + reason, no value.
    const domainRows = (await sqlClient`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${tid}::uuid
        AND topic = 'crm.pii.revealed'
      ORDER BY created_at DESC
    `) as unknown as Array<{ payload: Record<string, unknown> }>;
    const dom = domainRows.find((r) => (r.payload as { resourceId?: string }).resourceId === id);
    expect(dom).toBeTruthy();
    expect((dom!.payload as { field?: string }).field).toBe("citizenPhone");
    expect((dom!.payload as { reason?: string }).reason).toBe(reason);
    expect(JSON.stringify(dom!.payload)).not.toContain(PHONE);
  });

  it("404 when the resource does not exist", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/pii/reveal",
      headers: authHeaders(["crm_admin"], tid),
      payload: { resourceType: "grievance", resourceId: randomUUID(), field: "citizenPhone", reason: "service follow up" },
    });
    expect(res.statusCode).toBe(404);
  });
});
