/**
 * GAP-CITIZEN-DOCUMENTS-01 - /upload and the upload-source resubmission must
 * reference an object that was actually PUT: a presigned-but-never-uploaded key
 * is rejected 400 OBJECT_NOT_UPLOADED (DB-backed, object store reports "absent").
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

vi.mock("../src/modules/documents/storage.js", async (orig) => ({
  ...(await orig<typeof import("../src/modules/documents/storage.js")>()),
  objectExists: async () => false,
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0c00001-0000-4000-8000-000000000001";
const CITIZEN = "d0c00002-0000-4000-8000-0000000000e2";

function hdr() {
  const t = signToken({ sub: CITIZEN, tid: TENANT, roles: ["citizen"], sid: "sess-doc-exists" }, SECRET, 3600);
  return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

afterAll(async () => { await sqlClient.end(); });

describe("upload requires an object that exists in the store", () => {
  it("presigned but never PUT key is rejected 400 OBJECT_NOT_UPLOADED", async () => {
    const app = await buildApp();
    const pre = await app.inject({
      method: "POST", url: "/v1/citizen/documents/presign", headers: hdr(),
      payload: { filename: "doc.pdf", contentType: "application/pdf", sizeBytes: 1024 },
    });
    const key = pre.json().key as string;
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(),
      payload: { serviceId: "d0c00009-0000-4000-8000-000000000009", docType: "id_proof", storageKey: key },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("OBJECT_NOT_UPLOADED");
    await app.close();
  });
});
