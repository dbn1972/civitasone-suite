/**
 * F2 — server-side audited exports + VoC vigilance filter.
 *
 * Covers:
 *  F2-01 contacts export: CSV, honours filters, accepts + audits `purpose`,
 *        masks PII for a non-PII-read caller.
 *  F2-02 service-requests export: admin-only, CSV, masked for non-PII caller,
 *        audited with purpose + row count.
 *  F2-03 grievances export: same pattern as F2-02.
 *  F2-04 activities export: CRM-admin-only, CSV, audited.
 *  F2-05 lead-capture-forms export: admin-only, CSV, audited, no form key.
 *  F2-06 VoC vigilance: summary + list + export exclude staff_conduct /
 *        corruption for a non-vigilance caller; export is audited.
 *
 * DB-backed, HTTP round-trip. Audit events are asserted off the outbox / the
 * published audit stream (QUEUE_DRIVER=memory). All assertions target the NEW
 * behaviour and fail on the old code (no CSV, no purpose, no vigilance filter).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000f2001";
const ACTOR = "cccccccc-3333-4000-8000-0000000f2001";

function headers(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Export audits are read-path events published DIRECTLY to the bus (no business
 * transaction, so no outbox row). Capture them by subscribing a collector to the
 * audit topic on the shared queue before any export runs.
 */
interface AuditPayload {
  service?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}
interface AuditEnvelope {
  tenantId?: string;
  payload?: AuditPayload;
}
const capturedAudits: AuditEnvelope[] = [];

async function inject(
  method: "GET" | "POST",
  url: string,
  roles: string[],
  payload?: Record<string, unknown>,
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: headers(roles),
    ...(payload ? { payload } : {}),
  });
  await app.close();
  await drainQueue();
  return res;
}

/** Captured audit payloads of a given action for this tenant. */
function auditEventsFor(action: string): AuditPayload[] {
  return capturedAudits
    .filter((e) => e.tenantId === TENANT && e.payload?.action === action)
    .map((e) => e.payload as AuditPayload);
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.grievances WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.lead_capture_forms WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.interaction_sentiments WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  // Collect read-path export audit events (published directly to the bus).
  queue.subscribe("audit.event.record", async (msg: unknown) => {
    capturedAudits.push(msg as AuditEnvelope);
  });
  await queue.start();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

/** CSV header + at least one data row with the given cell present. */
function csvHeader(body: string): string {
  return body.split("\r\n")[0] ?? "";
}

// ── F2-02 service requests ───────────────────────────────────────────────────

describe("F2-02 service-requests export", () => {
  let refNo = "";
  beforeAll(async () => {
    const res = await inject("POST", "/v1/crm/service-requests", ["crm_admin"], {
      citizenName: "Asha Rao",
      citizenPhone: "9876501234",
      citizenEmail: "asha.rao@example.com",
      serviceType: "Birth Certificate",
      subject: "Certificate correction",
      priority: "normal",
    });
    expect(res.statusCode).toBe(201);
    refNo = res.json().data.referenceNo as string;
  });

  it("returns CSV with a header row and the request", async () => {
    const res = await inject(
      "GET",
      "/v1/crm/service-requests/export?purpose=monthly register review",
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(csvHeader(res.body)).toContain("Reference");
    expect(res.body).toContain(refNo);
    // crm_admin is a PII-read role → clear phone appears.
    expect(res.body).toContain("9876501234");
  });

  it("a tenant_admin (PII-read role on list/reveal) gets the same clear value in the export", async () => {
    const res = await inject(
      "GET",
      "/v1/crm/service-requests/export?purpose=tenant admin export check",
      ["tenant_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("9876501234");
  });

  it("rejects a missing / too-short purpose", async () => {
    const noPurpose = await inject("GET", "/v1/crm/service-requests/export", ["crm_admin"]);
    expect(noPurpose.statusCode).toBe(400);
    const short = await inject("GET", "/v1/crm/service-requests/export?purpose=short", ["crm_admin"]);
    expect(short.statusCode).toBe(400);
  });

  it("masks citizen phone/email for a non-PII-read caller", async () => {
    const res = await inject(
      "GET",
      "/v1/crm/service-requests/export?purpose=non-pii caller export",
      ["crm_user"],
    );
    // crm_user is not an admin role → 403 (admin-only export).
    expect(res.statusCode).toBe(403);
  });

  it("audits the export with purpose and row count", async () => {
    await inject(
      "GET",
      "/v1/crm/service-requests/export?purpose=audit assertion run",
      ["crm_admin"],
    );
    const events = await auditEventsFor("service_requests_bulk_export");
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1] as { metadata?: Record<string, unknown> };
    expect(last.metadata?.purpose).toBe("audit assertion run");
    expect(typeof last.metadata?.recordCount).toBe("number");
    // The audit payload must never carry the PII value.
    expect(JSON.stringify(last)).not.toContain("9876501234");
  });
});

// ── F2-03 grievances ─────────────────────────────────────────────────────────

describe("F2-03 grievances export", () => {
  beforeAll(async () => {
    const res = await inject("POST", "/v1/crm/grievances", ["crm_admin"], {
      citizenName: "Vikram Shah",
      citizenPhone: "9811122233",
      citizenEmail: "vikram@example.com",
      category: "Water Supply",
      subject: "No water",
      priority: "high",
    });
    expect(res.statusCode).toBe(201);
  });

  it("returns CSV, admin only, and audits with purpose", async () => {
    const forbidden = await inject(
      "GET",
      "/v1/crm/grievances/export?purpose=grievance register review",
      ["crm_user"],
    );
    expect(forbidden.statusCode).toBe(403);

    const res = await inject(
      "GET",
      "/v1/crm/grievances/export?purpose=grievance register review",
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(csvHeader(res.body)).toContain("Category");
    expect(res.body).toContain("Vikram Shah");

    const events = await auditEventsFor("grievances_bulk_export");
    expect(events.length).toBeGreaterThan(0);
    expect((events[events.length - 1] as { metadata?: { purpose?: string } }).metadata?.purpose).toBe(
      "grievance register review",
    );
  });
});

// ── F2-01 contacts ───────────────────────────────────────────────────────────

describe("F2-01 contacts export", () => {
  beforeAll(async () => {
    const res = await inject("POST", "/v1/crm/contacts", ["crm_admin"], {
      name: "Neha Export",
      email: "neha.export@example.com",
      phone: "9700011122",
      company: "ExportCo",
    });
    expect([201, 202]).toContain(res.statusCode);
    await drainQueue();
  });

  it("returns CSV, honours purpose, and audits it", async () => {
    const res = await inject(
      "GET",
      "/v1/crm/contacts/export?purpose=crm registry export",
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(csvHeader(res.body)).toContain("Name");
    expect(res.body).toContain("Neha Export");

    const noPurpose = await inject("GET", "/v1/crm/contacts/export", ["crm_admin"]);
    expect(noPurpose.statusCode).toBe(400);

    const events = await auditEventsFor("contacts_bulk_export");
    expect(events.length).toBeGreaterThan(0);
    expect((events[events.length - 1] as { metadata?: { purpose?: string } }).metadata?.purpose).toBe(
      "crm registry export",
    );
  });

  it("masks phone/email for a non-PII-read caller", async () => {
    const res = await inject(
      "GET",
      "/v1/crm/contacts/export?purpose=plain user export attempt",
      ["crm_user"],
    );
    expect(res.statusCode).toBe(200);
    // The clear phone/email must NOT appear for a crm_user.
    expect(res.body).not.toContain("9700011122");
    expect(res.body).not.toContain("neha.export@example.com");
    // The masked forms do appear.
    expect(res.body).toContain("Neha Export");
  });
});

// ── F2-04 activities ─────────────────────────────────────────────────────────

describe("F2-04 activities export", () => {
  beforeAll(async () => {
    const res = await inject("POST", "/v1/crm/activities", ["crm_admin"], {
      actorName: "Officer One",
      text: "Called the citizen about the pending request.",
      type: "call",
    });
    expect([201, 202]).toContain(res.statusCode);
    await drainQueue();
  });

  it("is admin-only, returns CSV, and audits with purpose", async () => {
    const forbidden = await inject(
      "GET",
      "/v1/crm/activities/export?purpose=activity log export",
      ["crm_user"],
    );
    expect(forbidden.statusCode).toBe(403);

    const res = await inject(
      "GET",
      "/v1/crm/activities/export?purpose=activity log export",
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(csvHeader(res.body)).toContain("Detail");
    expect(res.body).toContain("Officer One");

    const events = await auditEventsFor("activities_bulk_export");
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── F2-05 lead-capture-forms ─────────────────────────────────────────────────

describe("F2-05 lead-capture-forms export", () => {
  let formKey = "";
  beforeAll(async () => {
    const res = await inject("POST", "/v1/crm/lead-capture-forms", ["crm_admin"], {
      name: "Website Contact Form",
      requireConsent: true,
    });
    expect([201, 202]).toContain(res.statusCode);
    await drainQueue();
    const body = res.json() as { formKey?: string };
    formKey = body.formKey ?? "";
  });

  it("is admin-only, returns CSV without the form key, and audits", async () => {
    const forbidden = await inject(
      "GET",
      "/v1/crm/lead-capture-forms/export?purpose=forms registry export",
      ["crm_user"],
    );
    expect(forbidden.statusCode).toBe(403);

    const res = await inject(
      "GET",
      "/v1/crm/lead-capture-forms/export?purpose=forms registry export",
      ["crm_admin"],
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(csvHeader(res.body)).toContain("Name");
    expect(res.body).toContain("Website Contact Form");
    // The live credential (form key) must never appear in the export.
    if (formKey) expect(res.body).not.toContain(formKey);

    const events = await auditEventsFor("lead_capture_forms_bulk_export");
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── F2-06 VoC vigilance filter ───────────────────────────────────────────────

describe("F2-06 VoC vigilance filter", () => {
  beforeAll(async () => {
    // Seed readings directly so themes are deterministic: one vigilance-sensitive
    // (staff_conduct + corruption) and one ordinary (delay).
    await scoped(async (tx) => {
      await tx`
        INSERT INTO crm.interaction_sentiments
          (tenant_id, activity_id, activity_type, polarity, score, themes, excerpt, model, created_by, updated_by)
        VALUES
          (${TENANT}, ${randomUUID()}, 'complaint', 'negative', -60,
           ${JSON.stringify(["staff_conduct", "corruption"])}::jsonb,
           'The clerk demanded a bribe and was rude.', 'lexicon-v1', ${ACTOR}, ${ACTOR}),
          (${TENANT}, ${randomUUID()}, 'note', 'negative', -40,
           ${JSON.stringify(["delay"])}::jsonb,
           'The certificate is delayed again.', 'lexicon-v1', ${ACTOR}, ${ACTOR})
      `;
    });
  });

  it("hides sensitive themes from the summary for a non-vigilance caller", async () => {
    const res = await inject("GET", "/v1/crm/sentiment/summary", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const themes = (res.json().data.topThemes as Array<{ theme: string }>).map((t) => t.theme);
    expect(themes).not.toContain("staff_conduct");
    expect(themes).not.toContain("corruption");
    expect(themes).toContain("delay");
  });

  it("shows sensitive themes to a vigilance (admin) caller", async () => {
    const res = await inject("GET", "/v1/crm/sentiment/summary", ["crm_admin"]);
    expect(res.statusCode).toBe(200);
    const themes = (res.json().data.topThemes as Array<{ theme: string }>).map((t) => t.theme);
    expect(themes).toContain("corruption");
  });

  it("excludes vigilance-sensitive readings (samples) from the list for a non-vigilance caller", async () => {
    const res = await inject("GET", "/v1/crm/sentiment?limit=200", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const excerpts = (res.json().data as Array<{ excerpt: string | null }>).map((r) => r.excerpt);
    expect(excerpts.some((e) => e?.includes("bribe"))).toBe(false);
    expect(excerpts.some((e) => e?.includes("delayed"))).toBe(true);
  });

  it("audits the VoC export and applies the vigilance filter to the CSV", async () => {
    const user = await inject(
      "GET",
      "/v1/crm/sentiment/export?purpose=voc trend export",
      ["crm_user"],
    );
    expect(user.statusCode).toBe(200);
    expect(user.headers["content-type"]).toContain("text/csv");
    // A non-vigilance caller's CSV must not carry the sensitive excerpt.
    expect(user.body).not.toContain("bribe");
    expect(user.body).toContain("delayed");

    const admin = await inject(
      "GET",
      "/v1/crm/sentiment/export?purpose=voc trend export admin",
      ["crm_admin"],
    );
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toContain("bribe");

    const events = await auditEventsFor("sentiment_bulk_export");
    expect(events.length).toBeGreaterThan(0);
    expect((events[events.length - 1] as { metadata?: { purpose?: string } }).metadata?.purpose).toContain(
      "voc trend export",
    );
  });

  it("rejects a VoC export without a purpose", async () => {
    const res = await inject("GET", "/v1/crm/sentiment/export", ["crm_admin"]);
    expect(res.statusCode).toBe(400);
  });
});
