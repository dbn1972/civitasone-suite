/**
 * document module — HTTP route tests (task 16.1) via app.inject().
 *
 * Exercises all 6 document endpoints against a real Fastify app (buildApp) and the real
 * `meeting` Postgres schema (civitas_meeting), with HS256 test JWTs (JWT_ALGORITHM=HS256,
 * JWT_SECRET from vitest.config.ts). Object storage (@civitasone/storage) is mocked so the
 * upload staging + presigned-download paths never touch LocalStack/MinIO; everything else is
 * real. Every endpoint is covered for the mandated cases: happy path + 400 (validation) + 401
 * (unauthenticated) + 403 (forbidden) + 404 (not found), plus the classification-based access
 * control rules (Secret/Top_Secret → 404 for unauthorized; Top_Secret download → 403).
 *
 *   writes → 202 { data: { id, status: "accepted", correlationId } } (command queued)
 *   reads  → 200 { data }
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Mock object storage BEFORE importing the app (routes import it transitively via shared/infra).
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("%PDF-1.4 mock", "utf8")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://s3.mock/presigned-url"),
}));

import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a5a5a5a5-0000-4000-8000-0000000000d1";
const OTHER_TENANT = "a6a6a6a6-0000-4000-8000-0000000000d2";
const ACTOR = "90000000-0000-4000-8000-0000000000d1";

const MEETING = "b5b5b5b5-0000-4000-8000-0000000000d1";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

const DOC_INTERNAL = "c1000000-0000-4000-8000-0000000000d1";
const DOC_CONFIDENTIAL = "c2000000-0000-4000-8000-0000000000d1";
const DOC_SECRET = "c3000000-0000-4000-8000-0000000000d1";
const DOC_TOPSECRET = "c4000000-0000-4000-8000-0000000000d1";
const DOC_V1 = "c5000000-0000-4000-8000-0000000000d1";
const DOC_V2 = "c5000000-0000-4000-8000-0000000000d2";

// A tiny valid PDF (magic bytes "%PDF") so server-side MIME sniffing accepts the upload.
const PDF_BASE64 = Buffer.from("%PDF-1.4\n%mock pdf body\n", "utf8").toString("base64");
// A PNG-signature body that (mis)matches an application/pdf declaration → content_mismatch.
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

function token(roles: string[], tid: string = TENANT) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-doc" }, SECRET, 3600);
}
function auth(roles: string[], tid: string = TENANT) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}
/** Write headers incl. the mandatory idempotency key. */
function writeHeaders(roles: string[], tid: string = TENANT) {
  return { ...auth(roles, tid), "x-idempotency-key": `idem-${Math.random().toString(36).slice(2)}` };
}

async function seedDoc(id: string, classification: string, extra: Partial<{ previousVersionId: string; versionNum: number; documentType: string }> = {}) {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meeting_documents
      (id, tenant_id, meeting_id, file_name, mime_type, file_size_bytes, storage_key, hash,
       classification, document_type, version_num, previous_version_id, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${MEETING}, ${`doc-${classification}.pdf`}, 'application/pdf', 1024,
            ${`meeting/${TENANT}/documents/${id}`}, ${"a".repeat(64)}, ${classification},
            ${extra.documentType ?? "supporting_document"}, ${extra.versionNum ?? 1},
            ${extra.previousVersionId ?? null}, ${ACTOR}, ${ACTOR})`;
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });

  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.meetings (id, tenant_id, type, title, status, duration_minutes, created_by, updated_by)
    VALUES (${MEETING}, ${TENANT}, 'committee', 'Doc Meeting', 'scheduled', 60, ${ACTOR}, ${ACTOR})`;
  });

  await seedDoc(DOC_INTERNAL, "internal");
  await seedDoc(DOC_CONFIDENTIAL, "confidential");
  await seedDoc(DOC_SECRET, "secret");
  await seedDoc(DOC_TOPSECRET, "top_secret");
  await seedDoc(DOC_V1, "internal", { versionNum: 1 });
  await seedDoc(DOC_V2, "internal", { versionNum: 2, previousVersionId: DOC_V1 });

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_documents WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

// ─── POST /documents (upload) ──────────────────────────────────────────────
describe("POST /v1/meetings/:meetingId/documents", () => {
  const body = () => ({ fileName: "report.pdf", mimeType: "application/pdf", contentBase64: PDF_BASE64, documentType: "supporting_document" });

  it("202 accepts an upload (secretary)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: writeHeaders(["committee_secretary"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.status).toBe("accepted");
    expect(typeof json.data.id).toBe("string");
  });

  it("400 on an invalid body (missing fileName)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: writeHeaders(["committee_secretary"]),
      payload: { mimeType: "application/pdf", contentBase64: PDF_BASE64 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 DOCUMENT_INVALID_TYPE when the bytes do not match the declared MIME", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: writeHeaders(["committee_secretary"]),
      payload: { fileName: "report.pdf", mimeType: "application/pdf", contentBase64: PNG_BASE64 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DOCUMENT_INVALID_TYPE");
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: auth(["committee_secretary"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/meetings/${MEETING}/documents`, payload: body() });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer (upload is a write role)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: writeHeaders(["observer"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${MISSING}/documents`,
      headers: writeHeaders(["committee_secretary"]),
      payload: body(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /documents (list) ─────────────────────────────────────────────────
describe("GET /v1/meetings/:meetingId/documents", () => {
  it("200 returns all documents for a cleared secretary", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(DOC_SECRET);
    expect(ids).toContain(DOC_TOPSECRET);
  });

  it("200 filters out classified rows for an observer (clearance = internal)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(DOC_INTERNAL);
    expect(ids).not.toContain(DOC_CONFIDENTIAL);
    expect(ids).not.toContain(DOC_SECRET);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/documents` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the meeting does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING}/documents`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant isolation: another tenant sees the meeting as not found (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents`,
      headers: auth(["committee_secretary"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /documents/:documentId (metadata) ─────────────────────────────────
describe("GET /v1/meetings/:meetingId/documents/:documentId", () => {
  it("200 returns metadata for an internal document (observer)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(DOC_INTERNAL);
  });

  it("404 for a secret document viewed by an unauthorized observer (no existence leak)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_SECRET}`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 for a secret document viewed by a cleared secretary", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_SECRET}`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the document does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${MISSING}`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /documents/:documentId/download ───────────────────────────────────
describe("GET /v1/meetings/:meetingId/documents/:documentId/download", () => {
  it("200 returns a presigned URL for a downloadable document", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}/download`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.url).toContain("presigned");
  });

  it("403 for a top_secret document (view-only, no download) even when cleared", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_TOPSECRET}/download`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a secret document downloaded by an unauthorized observer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_SECRET}/download`,
      headers: auth(["observer"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}/download` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_INTERNAL}/download`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the document does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${MISSING}/download`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── DELETE /documents/:documentId (remove) ────────────────────────────────
describe("DELETE /v1/meetings/:meetingId/documents/:documentId", () => {
  it("202 accepts a soft-delete (secretary)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/documents/${DOC_CONFIDENTIAL}`,
      headers: writeHeaders(["committee_secretary"]),
      payload: { version: 1, reason: "superseded" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(DOC_CONFIDENTIAL);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/documents/${DOC_CONFIDENTIAL}`,
      headers: auth(["committee_secretary"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/${MEETING}/documents/${DOC_CONFIDENTIAL}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an observer (remove is a write role)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/documents/${DOC_CONFIDENTIAL}`,
      headers: writeHeaders(["observer"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the document does not exist", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${MEETING}/documents/${MISSING}`,
      headers: writeHeaders(["committee_secretary"]),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /documents/:documentId/versions ───────────────────────────────────
describe("GET /v1/meetings/:meetingId/documents/:documentId/versions", () => {
  it("200 returns the version lineage oldest → newest", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_V2}/versions`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; versionNum: number }>;
    expect(rows.map((r) => r.id)).toEqual([DOC_V1, DOC_V2]);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/documents/${DOC_V2}/versions` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unknown role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${DOC_V2}/versions`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 when the document does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/documents/${MISSING}/versions`,
      headers: auth(["committee_secretary"]),
    });
    expect(res.statusCode).toBe(404);
  });
});
