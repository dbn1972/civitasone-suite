/**
 * Application documents on real object storage (was: a fabricated https://s3.example.com/... URL).
 *
 *  - upload mints a real SigV4 presigned PUT for a tenant/application-namespaced KEY and validates type + size;
 *  - the consumer stores the KEY (never a URL); the application read-model exposes no key and no URL;
 *  - download mints a short-lived presigned GET after the tenant + ownership check
 *    (applicant and officers of the same tenant only; foreign tenant / other citizen -> 404);
 *  - legacy rows (fabricated link, no object) read as available=false and download -> 409 DOCUMENT_NOT_AVAILABLE;
 *  - RTI response URLs are http(s) only (no javascript:/data:).
 * DB-backed (RLS in force); only the object store HEAD is stubbed.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";

const exists = vi.fn(async (_key: string) => true);
vi.mock("@civitasone/storage", async (orig) => ({
  ...(await orig<typeof import("@civitasone/storage")>()),
  objectExists: (k: string) => exists(k),
}));
vi.mock("../src/modules/documents/storage.js", async (orig) => ({
  ...(await orig<typeof import("../src/modules/documents/storage.js")>()),
  objectExists: (k: string) => exists(k),
}));

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerApplicationConsumers } = await import("../src/modules/application/consumer.js");
const {
  buildApplicationDocumentKey, keyBelongsToApplication, applicationDocumentPrefix, downloadTtlSeconds, toDocumentView,
} = await import("../src/modules/application/docs-storage.js");
const { respondRtiBody } = await import("../src/modules/rti/validators.js");

registerApplicationConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dd000001-0000-4000-8000-000000000001";
const TENANT2 = "dd000002-0000-4000-8000-000000000002";
const APPLICANT = randomUUID();
const OTHER = randomUUID();
const OFFICER = randomUUID();
const SERVICE = randomUUID();

const tok = (tid: string, sub: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s-appdoc" }, SECRET);
const h = (tid: string, sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(tid, sub, roles)}`, "content-type": "application/json" });
const applicantH = h(TENANT, APPLICANT, ["citizen"]);
const otherH = h(TENANT, OTHER, ["citizen"]);
const officerH = h(TENANT, OFFICER, ["citizen_officer"]);
const foreignOfficerH = h(TENANT2, OFFICER, ["citizen_officer"]);

const app = await buildApp();
const post = (url: string, payload: unknown, headers: Record<string, string>) => app.inject({ method: "POST", url, headers, payload: payload as never });
const get = (url: string, headers: Record<string, string>) => app.inject({ method: "GET", url, headers });
async function waitFor(fn: () => Promise<boolean>, tries = 80) {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}
async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

const PDF = { docType: "id_proof", filename: "aadhaar.pdf", contentType: "application/pdf", sizeBytes: 120_000 };
let appId = "";

beforeAll(async () => {
  const r = await post("/v1/citizen/applications", { citizenId: APPLICANT, serviceId: SERVICE, serviceType: "birth_cert" }, applicantH);
  expect(r.statusCode).toBe(202);
  appId = r.json().id;
  expect(await waitFor(async () => (await get(`/v1/citizen/applications/${appId}`, applicantH)).statusCode === 200)).toBe(true);
}, 20000);

describe("object key helpers", () => {
  it("keys are tenant + application namespaced and keep the extension", () => {
    const k = buildApplicationDocumentKey(TENANT, appId || randomUUID(), "Scan.JPG");
    expect(k.startsWith(`citizen-documents/${TENANT}/applications/`)).toBe(true);
    expect(k.endsWith(".jpg")).toBe(true);
    expect(k).not.toContain("example.com");
  });
  it("keyBelongsToApplication rejects other tenants, other applications and traversal", () => {
    const a = randomUUID();
    const k = buildApplicationDocumentKey(TENANT, a, "x.pdf");
    expect(keyBelongsToApplication(k, TENANT, a)).toBe(true);
    expect(keyBelongsToApplication(k, TENANT2, a)).toBe(false);
    expect(keyBelongsToApplication(k, TENANT, randomUUID())).toBe(false);
    expect(keyBelongsToApplication(`${applicationDocumentPrefix(TENANT, a)}../../x`, TENANT, a)).toBe(false);
  });
  it("download TTL is short by default and bounded when overridden", () => {
    const prev = process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS;
    delete process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS;
    expect(downloadTtlSeconds()).toBe(300);
    process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS = "86400";
    expect(downloadTtlSeconds()).toBe(300);
    process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS = "120";
    expect(downloadTtlSeconds()).toBe(120);
    if (prev === undefined) delete process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS; else process.env.CITIZEN_DOC_DOWNLOAD_TTL_SECONDS = prev;
  });
  it("toDocumentView never leaks the key or a URL; legacy rows are unavailable", () => {
    const real = toDocumentView({ id: "d1", applicationId: "a1", docType: "x", uploadedAt: new Date(0), storageKey: "citizen-documents/t/applications/a1/k.pdf", originalFilename: "k.pdf", contentType: "application/pdf", sizeBytes: "10" });
    expect(real).toMatchObject({ available: true, downloadPath: "/v1/citizen/applications/a1/documents/d1/download", sizeBytes: 10 });
    expect(JSON.stringify(real)).not.toContain("citizen-documents/t");
    const legacy = toDocumentView({ id: "d2", applicationId: "a1", docType: "x", uploadedAt: new Date(0), storageKey: null });
    expect(legacy).toMatchObject({ available: false, downloadPath: null, unavailableReason: "DOCUMENT_NOT_AVAILABLE" });
  });
});

describe("POST /applications/:id/documents - real presigned upload", () => {
  it("returns a SigV4 presigned PUT for a namespaced key (no fabricated host) and records the KEY", async () => {
    const r = await post(`/v1/citizen/applications/${appId}/documents`, PDF, applicantH);
    expect(r.statusCode).toBe(202);
    const b = r.json().data;
    expect(b.method).toBe("PUT");
    expect(b.uploadUrl).toContain("X-Amz-Signature");
    expect(b.uploadUrl).not.toContain("s3.example.com");
    expect(b.key.startsWith(`citizen-documents/${TENANT}/applications/${appId}/`)).toBe(true);
    expect(b.headers["x-amz-server-side-encryption"]).toBe("AES256");

    expect(await waitFor(async () => (await sqlAsTenant(TENANT, (sql) => sql`select 1 from application.citizen_app_documents where id = ${b.id}`)).length === 1)).toBe(true);
    const [row] = await sqlAsTenant(TENANT, (sql) => sql`select storage_key, doc_url, content_type, size_bytes, original_filename from application.citizen_app_documents where id = ${b.id}`);
    expect(row).toMatchObject({ storage_key: b.key, doc_url: null, content_type: "application/pdf", original_filename: "aadhaar.pdf" });
    expect(Number(row!.size_bytes)).toBe(120_000);
  });

  it("400 FILE_REQUIRED without file metadata, INVALID_FILE_TYPE and FILE_TOO_LARGE on bad files", async () => {
    const url = `/v1/citizen/applications/${appId}/documents`;
    const none = await post(url, { docType: "id_proof" }, applicantH);
    expect(none.statusCode).toBe(400);
    expect(none.json().code).toBe("FILE_REQUIRED");
    const exe = await post(url, { ...PDF, filename: "run.exe", contentType: "application/x-msdownload" }, applicantH);
    expect(exe.statusCode).toBe(400);
    expect(exe.json().code).toBe("INVALID_FILE_TYPE");
    const big = await post(url, { ...PDF, sizeBytes: 50 * 1024 * 1024 }, applicantH);
    expect(big.statusCode).toBe(400);
    expect(big.json().code).toBe("FILE_TOO_LARGE");
  });

  it("another citizen cannot attach a document (404)", async () => {
    expect((await post(`/v1/citizen/applications/${appId}/documents`, PDF, otherH)).statusCode).toBe(404);
  });
});

describe("application read-model + download", () => {
  let docId = "";
  let legacyId = "";
  beforeAll(async () => {
    docId = (await post(`/v1/citizen/applications/${appId}/documents`, { ...PDF, filename: "marksheet.pdf" }, applicantH)).json().id;
    legacyId = randomUUID();
    await sqlAsTenant(TENANT, (sql) => sql`insert into application.citizen_app_documents (id, tenant_id, application_id, doc_type, doc_url, created_by, updated_by)
      values (${legacyId}, ${TENANT}, ${appId}, 'legacy_proof', ${"https://s3.example.com/x/applications/y/legacy_proof?expires=1"}, ${OFFICER}, ${OFFICER})`);
    expect(await waitFor(async () => (await get(`/v1/citizen/applications/${appId}`, applicantH)).json().documents?.some((d: { id: string }) => d.id === docId))).toBe(true);
  }, 20000);

  it("lists documents without any key or URL; the legacy row is available=false", async () => {
    const detail = (await get(`/v1/citizen/applications/${appId}`, applicantH)).json();
    const real = detail.documents.find((d: { id: string }) => d.id === docId);
    const legacy = detail.documents.find((d: { id: string }) => d.id === legacyId);
    expect(real).toMatchObject({ available: true, filename: "marksheet.pdf", downloadPath: `/v1/citizen/applications/${appId}/documents/${docId}/download` });
    expect(legacy).toMatchObject({ available: false, downloadPath: null, unavailableReason: "DOCUMENT_NOT_AVAILABLE" });
    const raw = JSON.stringify(detail.documents);
    expect(raw).not.toContain("citizen-documents/");
    expect(raw).not.toContain("s3.example.com");
    expect(raw).not.toContain("docUrl");
  });

  it("applicant gets a short-lived signed GET URL for their document", async () => {
    exists.mockResolvedValue(true);
    const r = await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, applicantH);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const b = r.json();
    expect(b.downloadUrl).toContain("X-Amz-Signature");
    expect(b.downloadUrl).toContain(`X-Amz-Expires=${b.expiresIn}`);
    expect(b.expiresIn).toBeLessThanOrEqual(3600);
    expect(b.downloadUrl).toContain(encodeURIComponent(TENANT).replace(/%2D/g, "-"));
    expect(b).toMatchObject({ filename: "marksheet.pdf", contentType: "application/pdf" });
  });

  it("an officer of the same tenant can download; another citizen and another tenant's officer get 404", async () => {
    exists.mockResolvedValue(true);
    expect((await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, officerH)).statusCode).toBe(200);
    expect((await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, otherH)).statusCode).toBe(404);
    expect((await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, foreignOfficerH)).statusCode).toBe(404);
    expect((await get(`/v1/citizen/applications/${appId}/documents/${randomUUID()}/download`, applicantH)).statusCode).toBe(404);
  });

  it("a legacy (fabricated-link) row is 409 DOCUMENT_NOT_AVAILABLE, never a URL", async () => {
    const r = await get(`/v1/citizen/applications/${appId}/documents/${legacyId}/download`, applicantH);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DOCUMENT_NOT_AVAILABLE");
    expect(r.body).not.toContain("s3.example.com");
  });

  it("a document whose upload never completed is 409; an unreachable store is 503 (retryable)", async () => {
    exists.mockResolvedValueOnce(false);
    const missing = await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, applicantH);
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe("DOCUMENT_NOT_AVAILABLE");
    exists.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const down = await get(`/v1/citizen/applications/${appId}/documents/${docId}/download`, applicantH);
    expect(down.statusCode).toBe(503);
    expect(down.json().code).toBe("STORAGE_UNAVAILABLE");
  });

  it("a queued pre-0046 command (no object key) is not recorded as a fake document", async () => {
    const before = (await get(`/v1/citizen/applications/${appId}`, applicantH)).json().documents.length;
    const id = randomUUID();
    await queue.publish("citizen.application.doc_upload", {
      messageId: id, type: "citizen.application.doc_upload", tenantId: TENANT, actorId: APPLICANT, correlationId: "c", schemaVersion: "1.0",
      payload: { id, applicationId: appId, tenantId: TENANT, docType: "stale", ownerCitizenId: APPLICANT },
    } as never);
    await new Promise((r) => setTimeout(r, 400));
    const rows = await sqlAsTenant(TENANT, (sql) => sql`select 1 from application.citizen_app_documents where id = ${id}`);
    expect(rows).toHaveLength(0);
    expect((await get(`/v1/citizen/applications/${appId}`, applicantH)).json().documents.length).toBe(before);
  });
});

describe("RTI response URL", () => {
  it("accepts http(s) and rejects script/data/file schemes (the host is whatever the officer supplies - not configured or hard-coded)", () => {
    expect(respondRtiBody.safeParse({ responseUrl: "https://smc.example.gov.in/rti/reply.pdf" }).success).toBe(true);
    expect(respondRtiBody.safeParse({ responseUrl: "http://intranet.local/r.pdf" }).success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x/y"]) {
      expect(respondRtiBody.safeParse({ responseUrl: bad }).success, bad).toBe(false);
    }
  });
});
