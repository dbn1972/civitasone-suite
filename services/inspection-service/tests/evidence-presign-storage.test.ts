/**
 * Integration tests for evidence presign (real S3 SigV4 vs not-configured) and
 * evidence read paths (SVC-103). Self-contained: db/infra/repo are mocked, so no
 * live Postgres/S3 is required. The presigned URL is produced by REAL offline
 * SigV4 signing when credentials are present.
 *
 * Validates: Requirements 7.3, 7.5, 7.6, 7.8
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";
const EVIDENCE_ID = "e0e0e0e0-f1f1-a2a2-b3b3-c4c4c4c4c4c4";
const INSPECTION_ID = "c0c0c0c0-d1d1-e2e2-f3f3-a4a4a4a4a4a4";

function makeToken(roles: string[]): string {
  return signToken({ sub: USER_ID, tid: TENANT_ID, roles, sid: "sess-test-1" }, SECRET, 3600);
}
const INSPECTOR_HEADER = { authorization: `Bearer ${makeToken(["inspector"])}` };
const REVIEWER_HEADER = { authorization: `Bearer ${makeToken(["reviewing_officer"])}` };
const AUDIT_HEADER = { authorization: `Bearer ${makeToken(["audit_officer"])}` };

const MOCK_EVIDENCE = {
  id: EVIDENCE_ID,
  tenantId: TENANT_ID,
  inspectionId: INSPECTION_ID,
  findingId: null,
  sha256Hash: "a".repeat(64),
  s3Key: `evidence/${TENANT_ID}/${INSPECTION_ID}/${EVIDENCE_ID}/photo.jpg`,
  mimeType: "image/jpeg",
  fileSizeBytes: 1024,
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

const mockFindEvidenceById = vi.fn();
const mockFindEvidenceByInspection = vi.fn();
const mockFindCustodyByEvidence = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})), execute: vi.fn() },
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
  findEvidenceById: (...a: unknown[]) => mockFindEvidenceById(...a),
  findEvidenceByInspection: (...a: unknown[]) => mockFindEvidenceByInspection(...a),
  findCustodyByEvidence: (...a: unknown[]) => mockFindCustodyByEvidence(...a),
  insertEvidence: vi.fn().mockResolvedValue({}),
  insertCustodyEntry: vi.fn().mockResolvedValue({}),
  updateEvidenceIntegrity: vi.fn().mockResolvedValue({}),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// Preserve/restore credential env between tests so both branches are exercised.
const ORIG = {
  key: process.env.AWS_ACCESS_KEY_ID,
  secret: process.env.AWS_SECRET_ACCESS_KEY,
};
beforeEach(() => {
  vi.clearAllMocks();
  mockFindEvidenceById.mockResolvedValue(null);
  mockFindEvidenceByInspection.mockResolvedValue({ data: [MOCK_EVIDENCE], meta: { page: 1, pageSize: 20, total: 1 } });
  mockFindCustodyByEvidence.mockResolvedValue([]);
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
});
afterAll(() => {
  if (ORIG.key) process.env.AWS_ACCESS_KEY_ID = ORIG.key;
  if (ORIG.secret) process.env.AWS_SECRET_ACCESS_KEY = ORIG.secret;
});

const VALID_PRESIGN = {
  fileName: "inspection-photo.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 2 * 1024 * 1024,
  inspectionId: INSPECTION_ID,
};

describe("POST /v1/inspection/evidence/presign — storage gating (SVC-103)", () => {
  it("returns an explicit not_configured status (no fake URL) when credentials are absent", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER, payload: VALID_PRESIGN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("not_configured");
    expect(body.data.uploadUrl).toBeUndefined(); // never a fabricated success
    expect(body.data.evidenceId).toBeDefined();
    expect(body.data.s3Key).toContain("evidence/");
  });

  it("returns a REAL SigV4 presigned PUT URL when storage is configured", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "secretkeyexample";
    const res = await app.inject({
      method: "POST", url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER, payload: VALID_PRESIGN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("ready");
    expect(body.data.uploadUrl).toContain("X-Amz-Signature=");
    expect(body.data.uploadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(body.data.expiresAt).toBeDefined();
    expect(body.data.s3Key).toContain(INSPECTION_ID);
  });

  it("still rejects a disallowed mime type before any storage lookup", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inspection/evidence/presign",
      headers: INSPECTOR_HEADER, payload: { ...VALID_PRESIGN, mimeType: "application/x-msdownload" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Evidence read paths", () => {
  it("GET /:id returns the artifact when found", async () => {
    mockFindEvidenceById.mockResolvedValue(MOCK_EVIDENCE);
    const res = await app.inject({
      method: "GET", url: `/v1/inspection/evidence/${EVIDENCE_ID}`, headers: INSPECTOR_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(EVIDENCE_ID);
  });

  it("GET list returns evidence for an inspection", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/inspection/evidence?inspectionId=${INSPECTION_ID}`, headers: REVIEWER_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("POST /:id/verify queues verification when evidence exists", async () => {
    mockFindEvidenceById.mockResolvedValue(MOCK_EVIDENCE);
    const res = await app.inject({
      method: "POST", url: `/v1/inspection/evidence/${EVIDENCE_ID}/verify`, headers: REVIEWER_HEADER,
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /:id/custody returns the chain of custody when evidence exists", async () => {
    mockFindEvidenceById.mockResolvedValue(MOCK_EVIDENCE);
    mockFindCustodyByEvidence.mockResolvedValue([{ action: "upload", actorId: USER_ID }]);
    const res = await app.inject({
      method: "GET", url: `/v1/inspection/evidence/${EVIDENCE_ID}/custody`, headers: AUDIT_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });
});
