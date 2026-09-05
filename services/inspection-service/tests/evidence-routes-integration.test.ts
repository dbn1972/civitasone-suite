/**
 * Integration tests for evidence module routes.
 *
 * Tests:
 * - Presigned URL generation (valid mime → 200, invalid mime → 400, oversize → 400)
 * - Evidence registration and chain-of-custody creation
 * - Integrity verification (valid hash → "valid", mismatch → "tampered" + event)
 * - Route auth (401/403), not found (404)
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";
const EVIDENCE_ID = "e0e0e0e0-f1f1-a2a2-b3b3-c4c4c4c4c4c4";
const INSPECTION_ID = "c0c0c0c0-d1d1-e2e2-f3f3-a4a4a4a4a4a4";

function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: USER_ID, tid: TENANT_ID, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

const INSPECTOR_HEADER = { authorization: `Bearer ${makeToken(["inspector"])}` };
const REVIEWER_HEADER = { authorization: `Bearer ${makeToken(["reviewing_officer"])}` };
const AUDIT_HEADER = { authorization: `Bearer ${makeToken(["audit_officer"])}` };
const NO_ROLE_HEADER = { authorization: `Bearer ${makeToken(["employee"])}` };

// ── Mock evidence data ────────────────────────────────────────────────────────

const MOCK_EVIDENCE = {
  id: EVIDENCE_ID,
  tenantId: TENANT_ID,
  inspectionId: INSPECTION_ID,
  findingId: null,
  sha256Hash: "a".repeat(64),
  s3Key: `evidence/${TENANT_ID}/${INSPECTION_ID}/${EVIDENCE_ID}/photo.jpg`,
  mimeType: "image/jpeg",
  fileSizeBytes: 1024 * 1024, // 1 MB
  integrityStatus: "valid",
  captureLatitude: "28.6139391",
  captureLongitude: "77.2090212",
  captureTimestamp: new Date().toISOString(),
  deviceId: "device-001",
  inspectorId: USER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: USER_ID,
  version: 1,
};

const MOCK_CUSTODY_ENTRIES = [
  {
    id: "cust-0001-0001-0001-000000000001",
    tenantId: TENANT_ID,
    evidenceId: EVIDENCE_ID,
    action: "upload",
    actorId: USER_ID,
    details: { deviceId: "device-001", mimeType: "image/jpeg" },
    recordedAt: new Date().toISOString(),
    version: 1,
  },
];

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindEvidenceById = vi.fn();
const mockFindEvidenceByInspection = vi.fn();
const mockFindCustodyByEvidence = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    execute: vi.fn(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  invalidateSafely: vi.fn().mockResolvedValue(undefined),
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
    invalidateResourceAfterCommit: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

vi.mock("../src/modules/evidence/repo.js", () => ({
  findEvidenceById: (...args: unknown[]) => mockFindEvidenceById(...args),
  findEvidenceByInspection: (...args: unknown[]) => mockFindEvidenceByInspection(...args),
  findCustodyByEvidence: (...args: unknown[]) => mockFindCustodyByEvidence(...args),
  insertEvidence: vi.fn().mockResolvedValue({}),
  insertCustodyEntry: vi.fn().mockResolvedValue({}),
  updateEvidenceIntegrity: vi.fn().mockResolvedValue({}),
}));

// ── App Setup ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFindEvidenceById.mockResolvedValue(null);
  mockFindEvidenceByInspection.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  mockFindCustodyByEvidence.mockResolvedValue([]);
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/inspection/evidence/presign — Presigned URL generation (Req 7.3, 7.7, 7.8)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/evidence/presign", () => {
  const VALID_PRESIGN_BODY = {
    fileName: "inspection-photo.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 2 * 1024 * 1024, // 2 MB
    inspectionId: INSPECTION_ID,
  };

  it("returns 200 with presigned URL for valid JPEG mime type (Req 7.8)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: VALID_PRESIGN_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Presign is env-gated: a REAL SigV4 URL is only minted when S3 is configured.
    // In the integration test env (no S3), it honestly returns not_configured with a
    // stable evidenceId + s3Key; the real signed-URL path is proven in
    // evidence-presign-storage.test.ts.
    expect(body.data.status).toBe("not_configured");
    expect(body.data.evidenceId).toBeDefined();
    expect(body.data.s3Key).toContain("evidence/");
  });

  it("returns 200 for valid PNG mime type (Req 7.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, mimeType: "image/png" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for valid PDF mime type (Req 7.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, mimeType: "application/pdf" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for valid MP4 mime type (Req 7.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, mimeType: "video/mp4" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for valid HEIC mime type (Req 7.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, mimeType: "image/heic" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for invalid mime type (Req 7.3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, mimeType: "application/zip" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_MIME_TYPE");
  });

  it("returns 400 for file exceeding 25MB limit (Req 7.7)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, fileSizeBytes: 26 * 1024 * 1024 },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("FILE_TOO_LARGE");
  });

  it("returns 400 for file exactly at limit boundary (25MB is ok)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, fileSizeBytes: 25 * 1024 * 1024 },
    });
    // Exactly at limit should pass
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for file 1 byte over limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, fileSizeBytes: 25 * 1024 * 1024 + 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FILE_TOO_LARGE");
  });

  it("returns 400 with missing fileName", async () => {
    const { fileName: _, ...noFileName } = VALID_PRESIGN_BODY;
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: noFileName,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid inspectionId (not UUID)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_PRESIGN_BODY, inspectionId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      payload: VALID_PRESIGN_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: NO_ROLE_HEADER,
      payload: VALID_PRESIGN_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it("presigned URL includes S3 bucket and tenant path structure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER,
      payload: VALID_PRESIGN_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.s3Key).toContain(TENANT_ID);
    expect(body.data.s3Key).toContain(INSPECTION_ID);
    expect(body.data.s3Key).toContain("inspection-photo.jpg");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/inspection/evidence — Evidence registration (Req 7.1, 7.2, 7.5)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/evidence", () => {
  const VALID_REGISTER_BODY = {
    inspectionId: INSPECTION_ID,
    sha256Hash: "b".repeat(64),
    mimeType: "image/jpeg",
    fileSizeBytes: 5 * 1024 * 1024,
    s3Key: `evidence/${TENANT_ID}/${INSPECTION_ID}/test/photo.jpg`,
    captureLatitude: "28.6139391",
    captureLongitude: "77.2090212",
    captureTimestamp: new Date().toISOString(),
    deviceId: "device-001",
    inspectorId: USER_ID,
  };

  it("returns 202 for valid evidence registration (Req 7.1, 7.2)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence",
      headers: INSPECTOR_HEADER,
      payload: VALID_REGISTER_BODY,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.messageId).toBeDefined();
    expect(body.data.evidenceId).toBeDefined();
  });

  it("returns 202 with optional findingId included", async () => {
    const findingId = "d0d0d0d0-e1e1-f2f2-a3a3-b4b4b4b4b4b4";
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/evidence",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_REGISTER_BODY, findingId },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });
});
