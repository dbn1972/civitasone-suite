/**
 * Integration tests for the PUBLIC, UNAUTHENTICATED lead-capture endpoint
 * (LM-002). There is no 401 to test here — instead these tests prove the
 * endpoint does not leak and cannot be abused:
 *
 *   • an unknown form key gives a GENERIC 404, indistinguishable from an
 *     unpublished form or a wrong tenant;
 *   • a submission CANNOT target another tenant;
 *   • an oversized body is refused (413);
 *   • an oversized UTM value is refused (422) and never truncated;
 *   • markup is refused, so no raw HTML is ever stored;
 *   • an attacker-chosen field name is NOT echoed back;
 *   • a hidden required field does not block submission;
 *   • a hidden field's submitted value is stripped and never persisted;
 *   • PII is ciphertext at rest;
 *   • the emitted event carries no PII;
 *   • rate limiting returns 429.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { registerConsumersOnce, drainQueue } from "./consumer-harness.js";
import { MAX_UTM_LENGTH } from "../src/modules/forms/lead-domain.js";
import {
  publicSubmissionFormLimiter,
  publicSubmissionIpLimiter,
} from "../src/modules/forms/rate-limit.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

function hdr(tid: string, actor: string) {
  return {
    authorization: `Bearer ${signToken({ sub: actor, tid, roles: ["metadata_admin"], sid: "sess-1" }, SECRET)}`,
    "content-type": "application/json",
  };
}
const JSON_HEADERS = { "content-type": "application/json" };

let app: FastifyInstance;

interface Fixture {
  layoutId: string;
  formVersionId: string;
  publicKey: string;
}

/**
 * Build a complete published, publicly-exposed form:
 *   entity + fields → layout → draft version → submit → approve → public endpoint
 */
async function seedPublishedPublicForm(
  tid: string,
  opts: { visibilityRules?: unknown[]; cascadeRules?: unknown[]; gstinRequired?: boolean } = {},
): Promise<Fixture> {
  const entityId = randomUUID();
  const layoutId = randomUUID();
  const api = `lead_${Math.floor(Math.random() * 1e9)}`;
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
    await sql`INSERT INTO metadata.entity_definitions
      (id, tenant_id, api_name, label, plural_label, created_by, updated_by)
      VALUES (${entityId}, ${tid}, ${api}, ${api}, ${api}, ${MAKER}, ${MAKER})`;
    for (const f of [
      { name: "entity_type", required: true },
      // Required only where a test needs to prove that a HIDDEN required field
      // does not block submission; optional otherwise.
      { name: "gstin", required: opts.gstinRequired ?? false },
      { name: "message", required: false },
    ]) {
      await sql`INSERT INTO metadata.field_definitions
        (tenant_id, entity_def_id, api_name, label, field_type, is_required, created_by, updated_by)
        VALUES (${tid}, ${entityId}, ${f.name}, ${f.name}, 'text', ${f.required}, ${MAKER}, ${MAKER})`;
    }
    await sql`INSERT INTO metadata.layout_definitions
      (id, tenant_id, entity_def_id, layout_type, sections, created_by, updated_by)
      VALUES (${layoutId}, ${tid}, ${entityId}, 'create', '[]'::jsonb, ${MAKER}, ${MAKER})`;
  });

  const draft = await app.inject({
    method: "POST",
    url: `/v1/metadata/forms/${layoutId}/versions`,
    headers: hdr(tid, MAKER),
    body: JSON.stringify({
      visibilityRules: opts.visibilityRules ?? [],
      cascadeRules: opts.cascadeRules ?? [],
    }),
  });
  expect(draft.statusCode).toBe(202);
  const formVersionId = draft.json().data.id as string;
  await drainQueue();

  const submit = await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${formVersionId}/submit`, headers: hdr(tid, MAKER), body: "{}" });
  expect(submit.statusCode).toBe(202);
  await drainQueue();
  const approve = await app.inject({
    method: "POST",
    url: `/v1/metadata/form-versions/${formVersionId}/approve`,
    headers: hdr(tid, CHECKER),
    body: "{}",
  });
  expect(approve.statusCode).toBe(202);
  await drainQueue();

  const endpoint = await app.inject({
    method: "POST",
    url: `/v1/metadata/form-versions/${formVersionId}/public-endpoints`,
    headers: hdr(tid, MAKER),
    body: JSON.stringify({ label: "Campaign landing form" }),
  });
  expect(endpoint.statusCode).toBe(202);
  await drainQueue();

  return { layoutId, formVersionId, publicKey: endpoint.json().data.publicKey as string };
}

function submitUrl(tid: string, key: string): string {
  return `/v1/metadata/public/tenants/${tid}/forms/${key}/submissions`;
}

/** Count rows actually persisted against one form version, under that tenant's GUC. */
async function countSubmissions(tid: string, formVersionId: string): Promise<number> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
    return sql`SELECT count(*)::int AS n FROM metadata.form_submissions
               WHERE tenant_id = ${tid} AND form_version_id = ${formVersionId}`;
  });
  return (rows[0] as { n: number }).n;
}

beforeAll(async () => {
  registerConsumersOnce();
  app = await buildApp();
});

afterEach(() => {
  // Keep the per-pod limiters from bleeding across tests.
  publicSubmissionIpLimiter.reset();
  publicSubmissionFormLimiter.reset();
});

afterAll(async () => {
  await app.close();
  for (const tid of [TENANT_A, TENANT_B]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await sql`DELETE FROM metadata.form_submissions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.form_public_endpoints WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.form_versions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.layout_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.field_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.entity_definitions WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM _outbox.messages WHERE tenant_id = ${tid}`;
    });
  }
  await sqlClient.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("LM-002 happy path — capture a lead with UTM, no auth", () => {
  it("accepts an UNAUTHENTICATED submission and captures all five UTM parameters", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS, // deliberately NO authorization header
      body: JSON.stringify({
        contact: { name: "Asha Menon", email: "asha@example.gov.in", phone: "9876543210" },
        answers: { entity_type: "company", gstin: "27AAAAA0000A1Z5", message: "please call me" },
        utm: {
          source: "google",
          medium: "cpc",
          campaign: "monsoon-2026",
          term: "government erp",
          content: "banner-a",
        },
      }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
    await drainQueue();
    const submissionId = res.json().data.id as string;

    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT * FROM metadata.form_submissions WHERE id = ${submissionId}`;
    });
    const row = rows[0] as Record<string, unknown>;
    expect(row.utm_source).toBe("google");
    expect(row.utm_medium).toBe("cpc");
    expect(row.utm_campaign).toBe("monsoon-2026");
    expect(row.utm_term).toBe("government erp");
    expect(row.utm_content).toBe("banner-a");
    expect(row.channel).toBe("public_web_form");
    expect(row.tenant_id).toBe(TENANT_A);
  });

  it("stores PII as ciphertext, not plaintext (DPDP)", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Rakesh Sharma", email: "rakesh@example.gov.in", phone: "9812345678" },
        answers: { entity_type: "individual", message: "call after 6pm" },
      }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const id = res.json().data.id as string;

    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT contact_name, contact_email, contact_phone, answers FROM metadata.form_submissions WHERE id = ${id}`;
    });
    const row = rows[0] as Record<string, string>;
    for (const col of ["contact_name", "contact_email", "contact_phone", "answers"] as const) {
      expect(row[col]?.startsWith("enc:v2:")).toBe(true);
    }
    expect(row.contact_name).not.toContain("Rakesh");
    expect(row.contact_email).not.toContain("example.gov.in");
    expect(row.contact_phone).not.toContain("9812345678");
    expect(row.answers).not.toContain("call after 6pm");
  });

  it("emits metadata.lead.captured through the outbox with NO PII in the payload", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Priya Nair", email: "priya@example.gov.in" },
        answers: { entity_type: "individual" },
        utm: { source: "linkedin", campaign: "q3" },
      }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const id = res.json().data.id as string;

    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT topic, payload FROM _outbox.messages
                 WHERE tenant_id = ${TENANT_A} AND topic = 'metadata.lead.captured'`;
    });
    const event = (rows as { topic: string; payload: Record<string, unknown> }[]).find(
      (r) => r.payload.submissionId === id,
    );
    expect(event).toBeDefined();
    const serialised = JSON.stringify(event?.payload ?? {});
    expect(serialised).not.toContain("Priya");
    expect(serialised).not.toContain("priya@example.gov.in");
    expect(event?.payload).toMatchObject({
      submissionId: id,
      tenantId: TENANT_A,
      channel: "public_web_form",
      hasEmail: true,
      hasPhone: false,
      utm: { source: "linkedin", campaign: "q3" },
    });
  });

  it("also emits an audit event", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Audit Check" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT count(*)::int AS n FROM _outbox.messages
                 WHERE tenant_id = ${TENANT_A} AND topic = 'audit.event.record'`;
    });
    expect((rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("derives UTM from a landing URL when explicit UTM is absent", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Landing Lead" },
        answers: { entity_type: "individual" },
        landingUrl: "https://civitasone.gov.in/erp?utm_source=newsletter&utm_campaign=aug",
      }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT utm_source, utm_campaign FROM metadata.form_submissions WHERE id = ${res.json().data.id}`;
    });
    expect(rows[0]).toMatchObject({ utm_source: "newsletter", utm_campaign: "aug" });
  });

  it("captures a lead with no UTM at all (attribution is optional)", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Direct Lead" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });
});

describe("LM-002 tenant isolation — the property that matters most", () => {
  it("a submission CANNOT target another tenant: A's key under B's path is a generic 404", async () => {
    const formA = await seedPublishedPublicForm(TENANT_A);

    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_B, formA.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Cross Tenant" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    // And nothing was written: not against A's form version, not under B at all.
    expect(await countSubmissions(TENANT_A, formA.formVersionId)).toBe(0);
    const bRows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
      return sql`SELECT count(*)::int AS n FROM metadata.form_submissions WHERE tenant_id = ${TENANT_B}`;
    });
    expect((bRows[0] as { n: number }).n).toBe(0);
  });

  it("a tenantId in the BODY is a 400, never an override", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Body Tenant" },
        answers: { entity_type: "individual" },
        tenantId: TENANT_B,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("an x-tenant-id header is ignored on the public route", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: { ...JSON_HEADERS, "x-tenant-id": TENANT_B },
      body: JSON.stringify({ contact: { name: "Header Tenant" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT tenant_id FROM metadata.form_submissions WHERE id = ${res.json().data.id}`;
    });
    expect((rows[0] as { tenant_id: string }).tenant_id).toBe(TENANT_A);
  });
});

describe("LM-002 does not leak — every resolution failure looks the same", () => {
  const generic = { code: "NOT_FOUND", message: "form not found" };

  it("404 for a well-formed but unknown key", async () => {
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, "a".repeat(64)),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X" }, answers: {} }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject(generic);
  });

  it("404 for a tenant that has nothing at all", async () => {
    const res = await app.inject({
      method: "POST",
      url: submitUrl(randomUUID(), "b".repeat(64)),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X" }, answers: {} }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject(generic);
  });

  it("404 once the exposed version is superseded — same generic error", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    // Publishing a second version supersedes the first, so its public endpoint
    // stops accepting traffic. An unapproved definition never receives leads.
    const draft = await app.inject({
      method: "POST",
      url: `/v1/metadata/forms/${form.layoutId}/versions`,
      headers: hdr(TENANT_A, MAKER),
      body: "{}",
    });
    expect(draft.statusCode).toBe(202);
    const v2 = draft.json().data.id as string;
    await drainQueue();
    const submit = await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${v2}/submit`, headers: hdr(TENANT_A, MAKER), body: "{}" });
    expect(submit.statusCode).toBe(202);
    await drainQueue();
    const approve = await app.inject({ method: "POST", url: `/v1/metadata/form-versions/${v2}/approve`, headers: hdr(TENANT_A, CHECKER), body: "{}" });
    expect(approve.statusCode).toBe(202);
    await drainQueue();

    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Late Lead" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject(generic);
  });

  it("404 once the endpoint is deactivated", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      await sql`UPDATE metadata.form_public_endpoints SET is_active = false WHERE public_key = ${form.publicKey}`;
    });
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X" }, answers: {} }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 for a malformed key (not 64 hex) — rejected before any DB work", async () => {
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, "short"),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X" }, answers: {} }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid tenant segment", async () => {
    const res = await app.inject({
      method: "POST",
      url: submitUrl("not-a-uuid", "c".repeat(64)),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X" }, answers: {} }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("LM-002 input bounds", () => {
  it("413 for an OVERSIZED BODY", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Flood" },
        answers: { message: "x".repeat(64 * 1024) },
      }),
    });
    expect(res.statusCode).toBe(413);
  });

  it("422 for an OVERSIZED UTM VALUE — refused, not truncated", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Long UTM" },
        answers: { entity_type: "individual" },
        utm: { campaign: "x".repeat(MAX_UTM_LENGTH + 1) },
      }),
    });
    // The zod schema bounds it first; either way the request is refused and the
    // value is never stored.
    expect([400, 422]).toContain(res.statusCode);
    expect(await countSubmissions(TENANT_A, form.formVersionId)).toBe(0);
  });

  it("422 for an oversized answer value", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Long answer" },
        answers: { entity_type: "individual", message: "x".repeat(2001) },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SUBMISSION_REJECTED");
  });

  it("400 when contact.name is missing", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: {}, answers: {} }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid email", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "X", email: "not-an-email" }, answers: {} }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a body that is not JSON at all", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: "}{ not json",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("LM-002 no stored XSS, no reflection", () => {
  it("422 for markup in an answer — raw HTML is never stored", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "XSS Probe" },
        answers: { entity_type: "individual", message: "<script>alert(1)</script>" },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(await countSubmissions(TENANT_A, form.formVersionId)).toBe(0);
  });

  it("422 for markup in the contact name", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "<img src=x onerror=alert(1)>" },
        answers: { entity_type: "individual" },
      }),
    });
    expect(res.statusCode).toBe(422);
  });

  it("does NOT reflect an attacker-chosen field name back in the error", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Probe" },
        answers: { entity_type: "individual", "\"><svg onload=alert(1)>": "x" },
      }),
    });
    expect(res.statusCode).toBe(422);
    const body = res.body;
    expect(body).not.toContain("onload");
    expect(body).not.toContain("svg");
    expect(res.json().error.details.reasons.join(" ")).toContain("unknown_field");
  });

  it("does not echo a rejected value back", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Probe" },
        answers: { entity_type: "individual", message: "MARKER<b>" },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain("MARKER");
  });

  it("a successful response echoes nothing but the new id", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Quiet Response", email: "quiet@example.gov.in" },
        answers: { entity_type: "individual" },
      }),
    });
    expect(res.statusCode).toBe(202);
    expect(Object.keys(res.json().data).sort()).toEqual(["id", "status"]);
    expect(res.json().data.status).toBe("accepted");
    expect(res.body).not.toContain("Quiet Response");
    expect(res.body).not.toContain("quiet@example.gov.in");
  });
});

describe("LM-002 + FRM-05 — hidden fields on a public submission", () => {
  const hideGstin = [{ field: "gstin", showWhen: 'entity_type == "company"' }];

  it("a HIDDEN REQUIRED FIELD DOES NOT BLOCK the submission", async () => {
    const form = await seedPublishedPublicForm(TENANT_A, { visibilityRules: hideGstin, gstinRequired: true });
    // `gstin` is required but hidden because entity_type is "individual".
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Individual Lead" },
        answers: { entity_type: "individual" },
      }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
  });

  it("the same field DOES block when it is visible", async () => {
    const form = await seedPublishedPublicForm(TENANT_A, { visibilityRules: hideGstin, gstinRequired: true });
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Company Lead" }, answers: { entity_type: "company" } }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SUBMISSION_INVALID");
  });

  it("a HIDDEN FIELD'S SUBMITTED VALUE IS STRIPPED and never persisted", async () => {
    const form = await seedPublishedPublicForm(TENANT_A, { visibilityRules: hideGstin });
    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Spoofer" },
        // gstin is hidden — the client sends it anyway.
        answers: { entity_type: "individual", gstin: "SPOOFED_VALUE" },
      }),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const id = res.json().data.id as string;

    // Read back through the authenticated API: the strip is recorded...
    const list = await app.inject({
      method: "GET",
      url: `/v1/metadata/form-versions/${form.formVersionId}/submissions?limit=10`,
      headers: hdr(TENANT_A, MAKER),
    });
    const captured = list.json().data.find((s: { id: string }) => s.id === id);
    expect(captured.strippedFields).toEqual(["gstin"]);

    // ...and the value itself is nowhere in the stored ciphertext or plaintext.
    const rows = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return sql`SELECT answers FROM metadata.form_submissions WHERE id = ${id}`;
    });
    expect((rows[0] as { answers: string }).answers).not.toContain("SPOOFED_VALUE");
  });

  it("cascade violations on a public submission are refused", async () => {
    const form = await seedPublishedPublicForm(TENANT_A, {
      cascadeRules: [{ field: "gstin", dependsOn: "entity_type", options: { company: ["GST-OK"] } }],
    });
    const bad = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Bad Cascade" },
        answers: { entity_type: "company", gstin: "GST-WRONG" },
      }),
    });
    expect(bad.statusCode).toBe(422);

    const good = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contact: { name: "Good Cascade" },
        answers: { entity_type: "company", gstin: "GST-OK" },
      }),
    });
    expect(good.statusCode).toBe(202);
    await drainQueue();
  });
});

describe("LM-002 rate limiting", () => {
  it("429 once the per-IP window is exhausted", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    // Exhaust the limiter directly rather than issuing hundreds of requests —
    // the limiter's own arithmetic is unit-tested separately.
    for (let i = 0; i < 1000; i++) publicSubmissionIpLimiter.hit("ip:127.0.0.1");

    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Flooder" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    expect(res.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("429 once the per-form window is exhausted, even from a fresh IP", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    for (let i = 0; i < 1000; i++) publicSubmissionFormLimiter.hit(`form:${form.publicKey}`);

    const res = await app.inject({
      method: "POST",
      url: submitUrl(TENANT_A, form.publicKey),
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact: { name: "Distributed" }, answers: { entity_type: "individual" } }),
    });
    expect(res.statusCode).toBe(429);
  });

  it("rate limits the public GET descriptor too", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    for (let i = 0; i < 1000; i++) publicSubmissionIpLimiter.hit("ip:127.0.0.1");
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/public/tenants/${TENANT_A}/forms/${form.publicKey}`,
    });
    expect(res.statusCode).toBe(429);
  });
});

describe("LM-002 public form descriptor", () => {
  it("describes the form without auth: fields, visibility and cascade options", async () => {
    const form = await seedPublishedPublicForm(TENANT_A, {
      visibilityRules: [{ field: "gstin", showWhen: 'entity_type == "company"' }],
      cascadeRules: [{ field: "gstin", dependsOn: "entity_type", options: { company: ["GST-OK"] } }],
    });
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/public/tenants/${TENANT_A}/forms/${form.publicKey}`,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.formVersionId).toBe(form.formVersionId);
    expect(data.fields.map((f: { apiName: string }) => f.apiName).sort()).toEqual([
      "entity_type",
      "gstin",
      "message",
    ]);
    // With no values entered, the conditional field is hidden and its cascade
    // offers nothing.
    expect(data.hiddenFields).toEqual(["gstin"]);
    expect(data.cascades[0].options).toEqual([]);
  });

  it("404 for an unknown key", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/public/tenants/${TENANT_A}/forms/${"d".repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for another tenant's key", async () => {
    const form = await seedPublishedPublicForm(TENANT_A);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/public/tenants/${TENANT_B}/forms/${form.publicKey}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 for a malformed key", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/metadata/public/tenants/${TENANT_A}/forms/nope`,
    });
    expect(res.statusCode).toBe(400);
  });
});
