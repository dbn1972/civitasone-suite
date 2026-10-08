/**
 * GAP-CITIZEN-DOCUMENTS-01 — real presign + upload transport.
 *
 * Asserts the NEW behaviour (fails on old code where upload accepted a bare
 * JSON declaration and fabricated a storageRef):
 *   • /presign validates size + content-type and returns a tenant+actor key.
 *   • /upload with NO storageKey is a 400 (file reference required).
 *   • /upload with a FORGED (foreign) key is a 400 (anti-forgery).
 *   • /upload with the presigned key records a submission whose storageRef IS
 *     that opaque object key (never an s3.example.com fabrication), pending
 *     verification + self_attested — DB-backed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import {
  validateUpload, buildStorageKey, keyBelongsToCaller, DOCUMENT_UPLOAD_LIMITS,
} from "../src/modules/documents/storage.js";
import type { FastifyInstance } from "fastify";

// The object store is not reachable in unit tests: treat every presigned key as
// already PUT (the uploader's HEAD check is covered in documents-object-exists.test.ts).
vi.mock("../src/modules/documents/storage.js", async (orig) => ({
  ...(await orig<typeof import("../src/modules/documents/storage.js")>()),
  objectExists: async () => true,
}));

registerDocumentsConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0c00001-0000-4000-8000-000000000001";
const CITIZEN = "d0c00002-0000-4000-8000-000000000002";
const OTHER = "d0c00003-0000-4000-8000-000000000003";

function tok(tenant: string, actor: string, roles = ["citizen"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-doc01" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function submissionById(id: string): Promise<{ storage_ref: string; status: string; verification_status: string; authenticity: string } | null> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return sql`SELECT storage_ref, status, verification_status, authenticity FROM documents.submissions WHERE id = ${id} AND tenant_id = ${TENANT}`;
  });
  return (rows[0] as { storage_ref: string; status: string; verification_status: string; authenticity: string } | undefined) ?? null;
}

describe("GAP-CITIZEN-DOCUMENTS-01 — upload limits (pure)", () => {
  it("rejects a disallowed extension", () => {
    expect(validateUpload({ filename: "x.exe", contentType: "application/pdf", sizeBytes: 100 })?.code).toBe("INVALID_FILE_TYPE");
  });
  it("rejects a disallowed content-type", () => {
    expect(validateUpload({ filename: "x.pdf", contentType: "application/x-msdownload", sizeBytes: 100 })?.code).toBe("INVALID_FILE_TYPE");
  });
  it("rejects an oversized file", () => {
    const tooBig = DOCUMENT_UPLOAD_LIMITS.maxSizeMb * 1024 * 1024 + 1;
    expect(validateUpload({ filename: "x.pdf", contentType: "application/pdf", sizeBytes: tooBig })?.code).toBe("FILE_TOO_LARGE");
  });
  it("accepts an allowed pdf within limits", () => {
    expect(validateUpload({ filename: "proof.pdf", contentType: "application/pdf", sizeBytes: 1024 })).toBeNull();
  });
  it("key anti-forgery: a key belongs only to its tenant+actor", () => {
    const key = buildStorageKey(TENANT, CITIZEN, "proof.pdf");
    expect(keyBelongsToCaller(key, TENANT, CITIZEN)).toBe(true);
    expect(keyBelongsToCaller(key, TENANT, OTHER)).toBe(false);
  });
});

describe("GAP-CITIZEN-DOCUMENTS-01 — presign + upload (DB-backed)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("presign returns a tenant+actor key and signed PUT url with size cap", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/presign", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { filename: "aadhaar.pdf", contentType: "application/pdf", sizeBytes: 2048 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.method).toBe("PUT");
    expect(body.maxSizeMb).toBe(DOCUMENT_UPLOAD_LIMITS.maxSizeMb);
    expect(body.key.startsWith(`citizen-documents/${TENANT}/${CITIZEN}/`)).toBe(true);
    expect(typeof body.uploadUrl).toBe("string");
  });

  it("presign rejects a disallowed type with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/presign", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { filename: "malware.exe", contentType: "application/x-msdownload", sizeBytes: 2048 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_FILE_TYPE");
  });

  it("upload WITHOUT a storageKey is a 400 (bare declaration no longer accepted)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { serviceId: "d0c00009-0000-4000-8000-000000000009", docType: "id_proof" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("upload with a FORGED foreign key is a 400", async () => {
    const foreign = buildStorageKey(TENANT, OTHER, "proof.pdf");
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { serviceId: "d0c00009-0000-4000-8000-000000000009", docType: "id_proof", storageKey: foreign },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_STORAGE_KEY");
  });

  it("upload with the presigned key records a submission referencing that object key", async () => {
    const presign = await app.inject({
      method: "POST", url: "/v1/citizen/documents/presign", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { filename: "aadhaar.pdf", contentType: "application/pdf", sizeBytes: 2048 },
    });
    const key = presign.json().key as string;
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT, CITIZEN)),
      payload: { serviceId: "d0c00009-0000-4000-8000-000000000009", docType: "id_proof", storageKey: key },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    const row = await waitFor(() => submissionById(id));
    expect(row.storage_ref).toBe(key);
    // the stored ref is an opaque object key, never a URL on the storage host
    expect(() => new URL(row.storage_ref)).toThrow();
    expect(row.status).toBe("received");
    expect(row.verification_status).toBe("pending");
    expect(row.authenticity).toBe("self_attested");
  });
});
