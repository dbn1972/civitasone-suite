import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  validateFolderDepth,
  assertCanDelete,
  assertCanModifyContent,
  computeDepth,
  DocumentDomainError,
  MAX_FOLDER_DEPTH,
} from "../src/modules/documents/domain.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000088";
const TENANT = "11111111-aaaa-4000-8000-000000000088";
const MATTER_ID = "22222222-bbbb-4000-8000-000000000088";
const DOC_UUID = "33333333-cccc-4000-8000-000000000088";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["legal_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — Folder Depth Validation (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Document domain — folder depth validation (pure)", () => {
  it("depth 0 parent → child at depth 1 is valid", () => {
    expect(() => validateFolderDepth(0)).not.toThrow();
  });

  it("depth 1 parent → child at depth 2 is valid", () => {
    expect(() => validateFolderDepth(1)).not.toThrow();
  });

  it("depth 2 parent → child at depth 3 is valid", () => {
    expect(() => validateFolderDepth(2)).not.toThrow();
  });

  it("depth 3 parent → child at depth 4 is valid (5th level = max)", () => {
    expect(() => validateFolderDepth(3)).not.toThrow();
  });

  it("depth 4 parent → child at depth 5 exceeds max and throws", () => {
    expect(() => validateFolderDepth(4)).toThrow(DocumentDomainError);
    try { validateFolderDepth(4); } catch (e: any) { expect(e.code).toBe("MAX_DEPTH_EXCEEDED"); }
  });

  it("depth 5 parent → child at depth 6 exceeds max and throws", () => {
    expect(() => validateFolderDepth(5)).toThrow(DocumentDomainError);
  });

  it("MAX_FOLDER_DEPTH is 5", () => {
    expect(MAX_FOLDER_DEPTH).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — Legal Hold Enforcement (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Document domain — legal hold enforcement (pure)", () => {
  it("assertCanDelete does not throw when legalHold=false", () => {
    expect(() => assertCanDelete(false)).not.toThrow();
  });

  it("assertCanDelete throws LEGAL_HOLD_ACTIVE when legalHold=true", () => {
    expect(() => assertCanDelete(true)).toThrow(DocumentDomainError);
    try { assertCanDelete(true); } catch (e: any) { expect(e.code).toBe("LEGAL_HOLD_ACTIVE"); }
  });

  it("assertCanModifyContent does not throw when legalHold=false", () => {
    expect(() => assertCanModifyContent(false)).not.toThrow();
  });

  it("assertCanModifyContent throws LEGAL_HOLD_ACTIVE when legalHold=true", () => {
    expect(() => assertCanModifyContent(true)).toThrow(DocumentDomainError);
    try { assertCanModifyContent(true); } catch (e: any) { expect(e.code).toBe("LEGAL_HOLD_ACTIVE"); }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN TESTS — Depth computation (pure)
// ══════════════════════════════════════════════════════════════════════════════
describe("Document domain — computeDepth (pure)", () => {
  it("null parent (root) → depth 0", () => {
    expect(computeDepth(null)).toBe(0);
  });

  it("parent depth 0 → child depth 1", () => {
    expect(computeDepth(0)).toBe(1);
  });

  it("parent depth 3 → child depth 4", () => {
    expect(computeDepth(3)).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Document CRUD
// ══════════════════════════════════════════════════════════════════════════════
describe("Document routes — CRUD", () => {
  it("POST /v1/legal/documents → 202 create folder", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(),
      payload: { matterId: MATTER_ID, name: "Evidence", type: "folder" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().id).toBeDefined();
  });

  it("POST /v1/legal/documents → 202 create file with body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(),
      payload: { matterId: MATTER_ID, name: "brief.pdf", type: "file", body: "File content here" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/legal/documents → 400 missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(),
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/documents → 400 invalid type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(),
      payload: { matterId: MATTER_ID, name: "test", type: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/documents → 401 no token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      payload: { matterId: MATTER_ID, name: "test", type: "folder" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/legal/documents → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(["citizen"]),
      payload: { matterId: MATTER_ID, name: "test", type: "folder" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/documents?matterId=... → 200 list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents?matterId=${MATTER_ID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(res.json()).toHaveProperty("meta");
  });

  it("GET /v1/legal/documents → 400 missing matterId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/documents",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/documents → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents?matterId=${MATTER_ID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/documents/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents/${DOC_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/documents/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/documents/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/documents/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/documents/${DOC_UUID}`,
      headers: authHeader(),
      payload: { name: "renamed.pdf" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/legal/documents/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/legal/documents/bad-uuid",
      headers: authHeader(),
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/documents/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/documents/${DOC_UUID}`,
      headers: authHeader(["citizen"]),
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/legal/documents/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/documents/${DOC_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/legal/documents/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/legal/documents/bad-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/legal/documents/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/documents/${DOC_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Version History
// ══════════════════════════════════════════════════════════════════════════════
describe("Document routes — version history", () => {
  it("GET /v1/legal/documents/:id/versions → 404 doc not found", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents/${DOC_UUID}/versions`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/documents/:id/versions → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/documents/bad-uuid/versions",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/documents/:id/versions → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents/${DOC_UUID}/versions`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Legal Hold
// ══════════════════════════════════════════════════════════════════════════════
describe("Document routes — legal hold", () => {
  it("POST /v1/legal/documents/:id/hold → 404 doc not found", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/legal/documents/${DOC_UUID}/hold`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/legal/documents/:id/hold → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents/bad-uuid/hold",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/documents/:id/hold → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/legal/documents/${DOC_UUID}/hold`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/legal/documents/:id/hold → 404 doc not found", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/documents/${DOC_UUID}/hold`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/legal/documents/:id/hold → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/legal/documents/bad-uuid/hold",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/legal/documents/:id/hold → 403 wrong role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/legal/documents/${DOC_UUID}/hold`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Audit officer access (read-only)
// ══════════════════════════════════════════════════════════════════════════════
describe("Document routes — audit_officer read access", () => {
  it("GET /v1/legal/documents → 200 with audit_officer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/legal/documents?matterId=${MATTER_ID}`,
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/legal/documents → 403 with audit_officer (no write)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/documents",
      headers: authHeader(["audit_officer"]),
      payload: { matterId: MATTER_ID, name: "test", type: "folder" },
    });
    expect(res.statusCode).toBe(403);
  });
});
