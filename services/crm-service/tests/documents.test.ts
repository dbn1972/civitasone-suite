/**
 * DM-001/002/003 Document & Attachment Management — HTTP → consumer → DB round-trips.
 *
 * Covers: presign (real signed URL + tenant-namespaced key), confirm (metadata +
 * versioning via supersedes), access-scoped list + cross-tenant RLS, download
 * blocked-when-infected, soft-delete, DM-002 document-types CRUD + verify, the
 * internal (service-secret gated) scan-result callback, and the expiry/mandatory
 * alert cycle.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { resetClient } from "@civitasone/storage";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { runTenantDocumentAlerts, runDocumentAlertCycle } from "../src/modules/documents/alert-scheduler.js";
import { scannerSqlClient } from "../src/shared/scanner-db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const INTERNAL_SECRET = "dm_test_internal_secret";
const TENANT = "aaaaaaaa-1111-4000-8000-00000000d001";
const OTHER = "aaaaaaaa-1111-4000-8000-00000000d009";
const ALERT_TENANT = "aaaaaaaa-1111-4000-8000-00000000d0a1";
const ALERT_TENANT_2 = "aaaaaaaa-1111-4000-8000-00000000d0a2";
const ACTOR = "cccccccc-3333-4000-8000-00000000d001";
const SUBJECT = "22222222-bbbb-4000-8000-00000000d001";

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { savedEnv[k] = process.env[k]; process.env[k] = v; }

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}
function adminHeaders(tenant = TENANT) { return headers(tenant, ["crm_admin"]); }
function internalHeaders(tenant = TENANT) {
  return { "x-internal": "1", "x-service-secret": INTERNAL_SECRET, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER, ALERT_TENANT, ALERT_TENANT_2]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.documents WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.document_types WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

beforeAll(async () => {
  setEnv("AWS_ACCESS_KEY_ID", "test");
  setEnv("AWS_SECRET_ACCESS_KEY", "test");
  setEnv("AWS_DEFAULT_REGION", "ap-south-1");
  setEnv("AWS_S3_BUCKET", "civitas-test");
  setEnv("AWS_ENDPOINT_URL", "http://localhost:14566"); // nothing listening → HeadObject fails fast
  setEnv("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET);
  setEnv("CRM_CONFIRM_REQUIRE_OBJECT", "0"); // skip the S3 existence probe for happy paths
  resetClient();
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetClient();
  await sqlClient.end();
});

async function inject(method: string, url: string, opts: { headers: Record<string, string>; payload?: unknown }) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: opts.headers, payload: opts.payload as object });
  await app.close();
  return res;
}

async function presign(body: Record<string, unknown>, tenant = TENANT) {
  return inject("POST", "/v1/crm/documents/presign", { headers: headers(tenant), payload: body });
}

async function confirm(body: Record<string, unknown>, tenant = TENANT) {
  const res = await inject("POST", "/v1/crm/documents", { headers: headers(tenant), payload: body });
  await drainQueue();
  return res;
}

async function listDocs(subjectId = SUBJECT, tenant = TENANT, includeSuperseded = false) {
  const res = await inject("GET",
    `/v1/crm/documents?subjectType=contact&subjectId=${subjectId}${includeSuperseded ? "&includeSuperseded=true" : ""}`,
    { headers: headers(tenant) });
  return res.json().data as Array<Record<string, unknown>>;
}

/** presign → (skip real PUT) → confirm using the returned key. Returns the new doc id. */
async function upload(overrides: Record<string, unknown> = {}, tenant = TENANT): Promise<string> {
  const pre = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "kyc.pdf", mimeType: "application/pdf" }, tenant);
  const { storageKey } = pre.json().data;
  const res = await confirm({
    subjectType: "contact", subjectId: SUBJECT, title: "KYC document",
    filename: "kyc.pdf", storageKey, mimeType: "application/pdf", sizeBytes: 2048,
    ...overrides,
  }, tenant);
  expect(res.statusCode).toBe(202);
  return res.json().id as string;
}

describe("DM-001 presign", () => {
  it("returns a REAL signed PUT URL and a tenant-namespaced key", async () => {
    const res = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "kyc.pdf", mimeType: "application/pdf" });
    expect(res.statusCode).toBe(200);
    const { storageKey, uploadUrl } = res.json().data;
    expect(storageKey).toMatch(new RegExp(`^crm/${TENANT}/contact/${SUBJECT}/[0-9a-f-]+/kyc.pdf$`));
    expect(uploadUrl).toContain("X-Amz-Signature=");
    expect(uploadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
  });
});

describe("DM-001 confirm + versioning", () => {
  it("confirms an upload (202) and reads back metadata", async () => {
    const id = await upload();
    const rows = await listDocs();
    const row = rows.find((r) => r.id === id)!;
    expect(row).toBeTruthy();
    expect(row.version).toBe(1);
    expect(row.isCurrent).toBe(true);
    expect(row.scanStatus).toBe("pending");
    expect(row.verificationStatus).toBe("pending");
    expect(row.storageProvider).toBe("s3");
    expect(Number(row.sizeBytes)).toBe(2048);
  });

  it("rejects a storageKey outside the tenant namespace (400)", async () => {
    const res = await confirm({
      subjectType: "contact", subjectId: SUBJECT, title: "x", filename: "x.pdf",
      storageKey: `crm/${OTHER}/contact/${SUBJECT}/abc/x.pdf`, mimeType: "application/pdf", sizeBytes: 1,
    });
    expect(res.statusCode).toBe(400);
  });

  it("supersedes: bumps version and demotes the prior current row", async () => {
    const v1 = await upload();
    const pre = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "kyc-v2.pdf", mimeType: "application/pdf" });
    const { storageKey } = pre.json().data;
    const res = await confirm({
      subjectType: "contact", subjectId: SUBJECT, title: "KYC v2", filename: "kyc-v2.pdf",
      storageKey, mimeType: "application/pdf", sizeBytes: 4096, supersedesId: v1,
    });
    expect(res.statusCode).toBe(202);
    const v2 = res.json().id as string;

    const all = await listDocs(SUBJECT, TENANT, true);
    const r1 = all.find((r) => r.id === v1)!;
    const r2 = all.find((r) => r.id === v2)!;
    expect(r1.isCurrent).toBe(false);
    expect(r2.isCurrent).toBe(true);
    expect(r2.version).toBe(2);
    expect(r1.lineageId).toBe(r2.lineageId);

    // The default (current-only) list shows just the new version for this lineage.
    const current = await listDocs();
    expect(current.filter((r) => r.lineageId === r2.lineageId).map((r) => r.id)).toEqual([v2]);
  });

  it("404s a supersedesId that does not exist", async () => {
    const pre = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "z.pdf", mimeType: "application/pdf" });
    const { storageKey } = pre.json().data;
    const res = await confirm({
      subjectType: "contact", subjectId: SUBJECT, title: "z", filename: "z.pdf",
      storageKey, mimeType: "application/pdf", sizeBytes: 1, supersedesId: "ffffffff-ffff-4000-8000-ffffffffffff",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects confirm when the object is absent and verification is on (422)", async () => {
    const pre = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "missing.pdf", mimeType: "application/pdf" });
    const { storageKey } = pre.json().data;
    process.env.CRM_CONFIRM_REQUIRE_OBJECT = "1";
    const res = await inject("POST", "/v1/crm/documents", {
      headers: headers(),
      payload: { subjectType: "contact", subjectId: SUBJECT, title: "m", filename: "missing.pdf", storageKey, mimeType: "application/pdf", sizeBytes: 1 },
    });
    process.env.CRM_CONFIRM_REQUIRE_OBJECT = "0";
    expect(res.statusCode).toBe(422);
  });
});

describe("DM-001 download scan gating", () => {
  it("blocks download (403) once a document is marked infected", async () => {
    const id = await upload();
    const scan = await inject("POST", `/v1/crm/documents/${id}/scan-result`, {
      headers: internalHeaders(), payload: { scanStatus: "infected" },
    });
    expect(scan.statusCode).toBe(202);
    await drainQueue();
    const dl = await inject("GET", `/v1/crm/documents/${id}/download`, { headers: headers() });
    expect(dl.statusCode).toBe(403);
  });

  it("blocks download (403) when the scan errored", async () => {
    const id = await upload();
    await inject("POST", `/v1/crm/documents/${id}/scan-result`, { headers: internalHeaders(), payload: { scanStatus: "error" } });
    await drainQueue();
    const dl = await inject("GET", `/v1/crm/documents/${id}/download`, { headers: headers() });
    expect(dl.statusCode).toBe(403);
  });

  it("allows download (200, signed GET) for a clean document", async () => {
    const id = await upload();
    await inject("POST", `/v1/crm/documents/${id}/scan-result`, { headers: internalHeaders(), payload: { scanStatus: "clean" } });
    await drainQueue();
    const dl = await inject("GET", `/v1/crm/documents/${id}/download`, { headers: headers() });
    expect(dl.statusCode).toBe(200);
    expect(dl.json().data.downloadUrl).toContain("X-Amz-Signature=");
  });

  it("withholds a pending download by default (409) and serves it only when explicitly opted out", async () => {
    const id = await upload();
    // Secure-by-default: a still-pending (unscanned) file is refused.
    const held = await inject("GET", `/v1/crm/documents/${id}/download`, { headers: headers() });
    expect(held.statusCode).toBe(409);
    // Operator opt-OUT: consciously accept serving unscanned files.
    process.env.CRM_ALLOW_PENDING_DOWNLOADS = "true";
    const ok = await inject("GET", `/v1/crm/documents/${id}/download`, { headers: headers() });
    delete process.env.CRM_ALLOW_PENDING_DOWNLOADS;
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.downloadUrl).toContain("X-Amz-Signature=");
  });

  it("rejects a scan-result that is not an internal service call (403)", async () => {
    const id = await upload();
    const res = await inject("POST", `/v1/crm/documents/${id}/scan-result`, { headers: adminHeaders(), payload: { scanStatus: "clean" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("DM-001 delete + RLS", () => {
  it("soft-deletes a document (202) so it drops out of the list", async () => {
    const id = await upload();
    const res = await inject("DELETE", `/v1/crm/documents/${id}`, { headers: headers() });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await listDocs()).map((r) => r.id)).not.toContain(id);
  });

  it("does not leak another tenant's documents (RLS + tenant scope)", async () => {
    await upload({}, OTHER);
    const otherRows = await listDocs(SUBJECT, OTHER);
    expect(otherRows.length).toBeGreaterThanOrEqual(1);
    for (const r of otherRows) expect(r).toBeTruthy();
    // TENANT's own list for the same subject never contains OTHER's rows (distinct ids).
    const mineIds = (await listDocs()).map((r) => r.id);
    for (const r of otherRows) expect(mineIds).not.toContain(r.id);
  });
});

describe("DM-002 document types + verify", () => {
  it("CRUD on document types", async () => {
    const create = await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(),
      payload: { code: "pan_card", name: "PAN Card", appliesTo: ["contact"], mandatory: true, verificationRequired: true },
    });
    expect(create.statusCode).toBe(201);
    const typeId = create.json().data.id as string;

    const dup = await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(), payload: { code: "pan_card", name: "dup", appliesTo: ["contact"] },
    });
    expect(dup.statusCode).toBe(409);

    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    expect((list.json().data as Array<{ code: string }>).some((t) => t.code === "pan_card")).toBe(true);

    const upd = await inject("PUT", `/v1/crm/document-types/${typeId}`, { headers: adminHeaders(), payload: { mandatory: false } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.mandatory).toBe(false);

    const del = await inject("DELETE", `/v1/crm/document-types/${typeId}`, { headers: adminHeaders() });
    expect(del.statusCode).toBe(204);
  });

  // Regression coverage: applies_to used to be a scalar column + z.enum() validator, so
  // ANY array the frontend's checkbox UI sent (even a single checked box) failed
  // validation unconditionally. Now a real array, allowing >1 subject type per document
  // type and an empty array as "applies to every subject type" (DocumentTypesEditor.tsx
  // / documents.ts's computeAlerts convention).
  it("persists appliesTo as a real multi-value array, and an update replaces it", async () => {
    const create = await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(),
      payload: { code: "id_proof", name: "ID Proof", appliesTo: ["contact", "account", "lead"] },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.appliesTo).toEqual(["contact", "account", "lead"]);
    const typeId = create.json().data.id as string;

    const list = await inject("GET", "/v1/crm/document-types", { headers: headers() });
    const listed = (list.json().data as Array<{ code: string; appliesTo: string[] }>).find((t) => t.code === "id_proof");
    expect(listed?.appliesTo).toEqual(["contact", "account", "lead"]);

    // Narrow it down to one subject type on update — a full replace, not a merge.
    const upd = await inject("PUT", `/v1/crm/document-types/${typeId}`, {
      headers: adminHeaders(), payload: { appliesTo: ["account"] },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.appliesTo).toEqual(["account"]);

    // The empty array is a deliberate, distinct value ("applies to everything"), not an
    // error — must round-trip too, not get coerced to something else.
    const wild = await inject("PUT", `/v1/crm/document-types/${typeId}`, {
      headers: adminHeaders(), payload: { appliesTo: [] },
    });
    expect(wild.statusCode).toBe(200);
    expect(wild.json().data.appliesTo).toEqual([]);
  });

  it("rejects a subject type outside the known six inside the appliesTo array (400)", async () => {
    const res = await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(), payload: { code: "bad_type", name: "Bad", appliesTo: ["contact", "not_a_real_subject"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("forbids a non-admin from creating a document type (403)", async () => {
    const res = await inject("POST", "/v1/crm/document-types", {
      headers: headers(), payload: { code: "gst", name: "GST", appliesTo: ["account"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("records a verification decision (202) that lands on the document", async () => {
    const id = await upload();
    const res = await inject("POST", `/v1/crm/documents/${id}/verify`, { headers: headers(), payload: { status: "verified" } });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    const row = (await listDocs()).find((r) => r.id === id)!;
    expect(row.verificationStatus).toBe("verified");
    expect(row.verifiedBy).toBe(ACTOR);
  });
});

describe("DM-002 alert scheduler round-trip", () => {
  it("emits an alert for an expired document and runs the cross-tenant cycle", async () => {
    // A mandatory type (exercises the missing-mandatory scan) + one already-expired doc.
    await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(ALERT_TENANT),
      payload: { code: "trade_licence", name: "Trade Licence", appliesTo: ["contact"], mandatory: true, expiryRequired: true },
    });
    const pre = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "lic.pdf", mimeType: "application/pdf" }, ALERT_TENANT);
    const { storageKey } = pre.json().data;
    const c = await confirm({
      subjectType: "contact", subjectId: SUBJECT, title: "Licence", filename: "lic.pdf",
      storageKey, mimeType: "application/pdf", sizeBytes: 10, docType: "trade_licence", expiryDate: "2020-01-01",
    }, ALERT_TENANT);
    expect(c.statusCode).toBe(202);

    const emitted = await runTenantDocumentAlerts(ALERT_TENANT, new Date("2026-08-05T00:00:00Z"));
    expect(emitted).toBeGreaterThanOrEqual(1); // at least the expired-document alert

    // The cross-tenant cycle discovers ALERT_TENANT via list_document_alert_tenants().
    const total = await runDocumentAlertCycle(new Date("2026-08-05T00:00:00Z"));
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("a mandatory type with appliesTo=[] (wildcard) is scanned as applying to every enumerable subject type", async () => {
    // Previously impossible to even express: the old scalar applies_to column required
    // exactly one of the six names, with no "applies to everything" value. Confirms
    // alert-scheduler.ts's expansion of an empty appliesTo actually reaches "contact"
    // (SUBJECT has no "universal_id" document on file) instead of silently matching
    // nothing (which is what treating appliesTo as an opaque, never-equal Map key would
    // have done for an array/empty value).
    const create = await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(ALERT_TENANT),
      payload: { code: "universal_id", name: "Universal ID", appliesTo: [], mandatory: true },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.appliesTo).toEqual([]);

    const emitted = await runTenantDocumentAlerts(ALERT_TENANT, new Date("2026-08-05T00:00:00Z"));
    expect(emitted).toBeGreaterThanOrEqual(1); // SUBJECT is missing a "universal_id" doc
  });

  it("list_document_alert_tenants() discovers tenants across the WHOLE table, not just one (BYPASSRLS scanner)", async () => {
    // A second, independent tenant with its own expired trade_licence — proves
    // the cross-tenant discovery step (crm_scanner, BYPASSRLS; see
    // 0089_crm_scanner_role.sql) really scans across tenants, rather than only
    // ever surfacing whichever single tenant an earlier test happened to seed.
    await inject("POST", "/v1/crm/document-types", {
      headers: adminHeaders(ALERT_TENANT_2),
      payload: { code: "trade_licence", name: "Trade Licence", appliesTo: ["contact"], mandatory: true, expiryRequired: true },
    });
    const pre2 = await presign({ subjectType: "contact", subjectId: SUBJECT, filename: "lic2.pdf", mimeType: "application/pdf" }, ALERT_TENANT_2);
    const c2 = await confirm({
      subjectType: "contact", subjectId: SUBJECT, title: "Licence", filename: "lic2.pdf",
      storageKey: pre2.json().data.storageKey, mimeType: "application/pdf", sizeBytes: 10,
      docType: "trade_licence", expiryDate: "2020-01-01",
    }, ALERT_TENANT_2);
    expect(c2.statusCode).toBe(202);

    // The raw discovery function itself must name BOTH tenants.
    const discovered = (await scannerSqlClient`SELECT tenant_id FROM crm.list_document_alert_tenants()`) as unknown as Array<{ tenant_id: string }>;
    const discoveredIds = discovered.map((r) => r.tenant_id);
    expect(discoveredIds).toEqual(expect.arrayContaining([ALERT_TENANT, ALERT_TENANT_2]));

    // And the full cycle actually processes both, not just the first one found.
    const total = await runDocumentAlertCycle(new Date("2026-08-05T00:00:00Z"));
    expect(total).toBeGreaterThanOrEqual(2); // at least one expired-doc alert per tenant
  });
});
