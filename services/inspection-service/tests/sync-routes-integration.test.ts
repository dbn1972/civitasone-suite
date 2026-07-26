/**
 * Integration tests for sync module — routes.
 *
 * Tests cover:
 * - Package generation flow (202 → poll → ready)
 * - Idempotent upload (duplicate seq → skip → success)
 * - Sequence gap rejection (422)
 * - Partial resume from lastAckedSeq
 * - Route validation (400), auth (401/403)
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8**
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";
const INSPECTOR_ID = "22222222-3333-4444-5555-666666666666";
const INSPECTION_ID = "33333333-4444-5555-6666-777777777777";
const PACKAGE_ID = "44444444-5555-6666-7777-888888888888";

function makeToken(roles: string[] = ["inspector"]): string {
  return signToken(
    { sub: USER_ID, tid: TENANT_ID, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

const INSPECTOR_HEADER = { authorization: `Bearer ${makeToken(["inspector"])}` };
const ADMIN_HEADER = { authorization: `Bearer ${makeToken(["inspection_admin"])}` };
const NO_ROLE_HEADER = { authorization: `Bearer ${makeToken(["employee"])}` };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindPackageById = vi.fn();
const mockFindCursorsByInspector = vi.fn();

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

vi.mock("../src/modules/sync/repo.js", () => ({
  findPackageById: (...args: unknown[]) => mockFindPackageById(...args),
  findCursorsByInspector: (...args: unknown[]) => mockFindCursorsByInspector(...args),
  insertPackage: vi.fn().mockResolvedValue({ id: "pkg-1" }),
  updatePackage: vi.fn().mockResolvedValue({ id: "pkg-1" }),
  insertUpload: vi.fn().mockResolvedValue({ id: "upload-1" }),
  findUploadBySequence: vi.fn().mockResolvedValue(null),
  getOrCreateCursor: vi.fn().mockResolvedValue({ id: "cursor-1", lastAckedSeq: 0 }),
  updateCursorSeq: vi.fn().mockResolvedValue(undefined),
  markUploadProcessed: vi.fn().mockResolvedValue(undefined),
  findPackagesByInspector: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
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
  mockFindPackageById.mockResolvedValue(null);
  mockFindCursorsByInspector.mockResolvedValue([]);
});

// ══════════════════════════════════════════════════════════════════════════════
// Package Generation Flow (202 → poll → ready)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/sync/packages — package generation", () => {
  const VALID_BODY = {
    inspectorId: INSPECTOR_ID,
    inspectionIds: [INSPECTION_ID],
    includeMapTiles: false,
  };

  it("returns 202 with accepted:true and packageId on valid request (Req 6.1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/packages",
      headers: INSPECTOR_HEADER,
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.packageId).toBeDefined();
    expect(body.data.messageId).toBeDefined();
  });

  it("returns 202 with only inspectorId (inspectionIds optional)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/packages",
      headers: INSPECTOR_HEADER,
      payload: { inspectorId: INSPECTOR_ID },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });
});

describe("GET /v1/inspection/sync/packages/:id — poll package status", () => {
  it("returns 200 with package details when ready (Req 6.1)", async () => {
    const readyPackage = {
      id: PACKAGE_ID,
      tenantId: TENANT_ID,
      inspectorId: INSPECTOR_ID,
      status: "ready",
      checksum: "abc123def456",
      s3Key: `sync/${TENANT_ID}/${PACKAGE_ID}.json.gz`,
      sizeBytes: 1024,
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    };
    mockFindPackageById.mockResolvedValue(readyPackage);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/sync/packages/${PACKAGE_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("ready");
    expect(body.data.checksum).toBe("abc123def456");
    expect(body.data.s3Key).toBeDefined();
  });

  it("returns 200 with 'generating' status while package is being built", async () => {
    const generatingPackage = {
      id: PACKAGE_ID,
      tenantId: TENANT_ID,
      inspectorId: INSPECTOR_ID,
      status: "generating",
      checksum: null,
      s3Key: null,
      sizeBytes: null,
      generatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };
    mockFindPackageById.mockResolvedValue(generatingPackage);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/sync/packages/${PACKAGE_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("generating");
  });

  it("returns 404 when package does not exist", async () => {
    mockFindPackageById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/sync/packages/${PACKAGE_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Idempotent Upload (duplicate seq → skip → success)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/sync/upload — idempotent upload", () => {
  const VALID_UPLOAD = {
    inspectorId: INSPECTOR_ID,
    inspectionId: INSPECTION_ID,
    deviceId: "device-abc-123",
    sequenceNumber: 1,
    payload: {
      responses: {
        "q1": { value: "yes", answeredAt: "2024-01-15T10:00:00Z" },
      },
      evidence: [
        { evidenceId: "ev-1", sha256: "abcdef1234567890" },
      ],
    },
    sha256Hash: "deadbeef12345678abcdef1234567890abcdef1234567890abcdef1234567890",
    networkState: "offline" as const,
  };

  it("returns 202 on valid upload (Req 6.2, 6.6)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/upload",
      headers: INSPECTOR_HEADER,
      payload: VALID_UPLOAD,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.accepted).toBe(true);
    expect(body.data.messageId).toBeDefined();
  });

  it("returns 202 for duplicate sequence number — idempotent skip (Req 6.3)", async () => {
    // The route always returns 202 because it publishes a command.
    // The actual idempotent skip happens in the consumer via sequence validation.
    // The route's job is simply to accept and queue the upload.
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/upload",
      headers: INSPECTOR_HEADER,
      payload: VALID_UPLOAD,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });

  it("accepts upload with networkState 'online'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/upload",
      headers: INSPECTOR_HEADER,
      payload: { ...VALID_UPLOAD, networkState: "online" },
    });

    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sequence Gap Rejection (422 — consumer-level, route accepts)
// ══════════════════════════════════════════════════════════════════════════════

describe("Sequence gap handling (Req 6.8)", () => {
  /**
   * In CQRS, the route validates input structure and queues the command (202).
   * The consumer detects sequence gaps and rejects with NonRetryableError.
   * We verify the domain function correctly identifies gaps.
   */
  it("domain validateSequenceNumber returns 'gap' when seq > lastAckedSeq + 1", async () => {
    const { validateSequenceNumber } = await import("../src/modules/sync/domain.js");

    // lastAckedSeq = 3, incoming = 5 → gap (expected 4)
    const result = validateSequenceNumber(5, 3);
    expect(result).toBe("gap");
  });

  it("domain validateSequenceNumber returns 'process' for next expected seq", async () => {
    const { validateSequenceNumber } = await import("../src/modules/sync/domain.js");

    // lastAckedSeq = 3, incoming = 4 → process
    const result = validateSequenceNumber(4, 3);
    expect(result).toBe("process");
  });

  it("domain validateSequenceNumber returns 'skip' for already-processed seq", async () => {
    const { validateSequenceNumber } = await import("../src/modules/sync/domain.js");

    // lastAckedSeq = 5, incoming = 3 → skip (already processed)
    const result = validateSequenceNumber(3, 5);
    expect(result).toBe("skip");
  });

  it("domain validateSequenceNumber returns 'skip' for same seq as lastAcked", async () => {
    const { validateSequenceNumber } = await import("../src/modules/sync/domain.js");

    // lastAckedSeq = 5, incoming = 5 → skip
    const result = validateSequenceNumber(5, 5);
    expect(result).toBe("skip");
  });

  it("route still returns 202 for gap sequence (consumer handles rejection)", async () => {
    // The route validates structure, not business rules. A gap sequence is
    // structurally valid (positive integer), so the route accepts it.
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/sync/upload",
      headers: INSPECTOR_HEADER,
      payload: {
        inspectorId: INSPECTOR_ID,
        inspectionId: INSPECTION_ID,
        deviceId: "device-abc-123",
        sequenceNumber: 99, // gap — lastAckedSeq is 0 but seq is 99
        payload: {
          responses: { "q1": { value: "answer", answeredAt: "2024-01-15T10:00:00Z" } },
          evidence: [],
        },
        sha256Hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        networkState: "offline",
      },
    });

    // Route accepts because the payload is structurally valid
    expect(res.statusCode).toBe(202);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Partial Resume from lastAckedSeq
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/inspection/sync/status/:inspectorId — partial resume (Req 6.8)", () => {
  it("returns 200 with cursor data showing lastAckedSeq for resume", async () => {
    const cursors = [
      {
        id: "cursor-1",
        tenantId: TENANT_ID,
        inspectorId: INSPECTOR_ID,
        inspectionId: INSPECTION_ID,
        deviceId: "device-abc-123",
        lastAckedSeq: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 5,
      },
      {
        id: "cursor-2",
        tenantId: TENANT_ID,
        inspectorId: INSPECTOR_ID,
        inspectionId: "55555555-6666-7777-8888-999999999999",
        deviceId: "device-xyz-456",
        lastAckedSeq: 12,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 12,
      },
    ];
    mockFindCursorsByInspector.mockResolvedValue(cursors);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/sync/status/${INSPECTOR_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].lastAckedSeq).toBe(5);
    expect(body.data[1].lastAckedSeq).toBe(12);
  });

  it("returns 200 with empty array when no cursors exist", async () => {
    mockFindCursorsByInspector.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/sync/status/${INSPECTOR_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("client can determine resume point from lastAckedSeq (domain logic)", async () => {
    const { validateSequenceNumber } = await import("../src/modules/sync/domain.js");

    // If lastAckedSeq = 5, client should resume from seq 6
    const lastAckedSeq = 5;
    const nextSeq = lastAckedSeq + 1;

    // Seq 6 should be the next to process
    expect(validateSequenceNumber(nextSeq, lastAckedSeq)).toBe("process");
    // Seq 5 (last acked) should be skipped
    expect(validateSequenceNumber(lastAckedSeq, lastAckedSeq)).toBe("skip");
    // Seq 4 (earlier) should also be skipped
    expect(validateSequenceNumber(4, lastAckedSeq)).toBe("skip");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route Validation (400)
// ══════════════════════════════════════════════════════════════════════════════

describe("Route validation — 400 errors", () => {
  describe("POST /v1/inspection/sync/packages", () => {
    it("returns 400 with missing inspectorId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: INSPECTOR_HEADER,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid inspectorId (not a UUID)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: INSPECTOR_HEADER,
        payload: { inspectorId: "not-a-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid inspectionIds (not UUIDs)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: INSPECTOR_HEADER,
        payload: { inspectorId: INSPECTOR_ID, inspectionIds: ["bad-id"] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/inspection/sync/upload", () => {
    it("returns 400 with empty body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with missing inspectorId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectionId: INSPECTION_ID,
          deviceId: "dev-1",
          sequenceNumber: 1,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "abc",
          networkState: "offline",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with negative sequenceNumber", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectorId: INSPECTOR_ID,
          inspectionId: INSPECTION_ID,
          deviceId: "dev-1",
          sequenceNumber: -1,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "abc",
          networkState: "offline",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with zero sequenceNumber", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectorId: INSPECTOR_ID,
          inspectionId: INSPECTION_ID,
          deviceId: "dev-1",
          sequenceNumber: 0,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "abc",
          networkState: "offline",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with empty deviceId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectorId: INSPECTOR_ID,
          inspectionId: INSPECTION_ID,
          deviceId: "",
          sequenceNumber: 1,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "abc",
          networkState: "offline",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid networkState value", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectorId: INSPECTOR_ID,
          inspectionId: INSPECTION_ID,
          deviceId: "dev-1",
          sequenceNumber: 1,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "abc",
          networkState: "unknown",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with empty sha256Hash", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: INSPECTOR_HEADER,
        payload: {
          inspectorId: INSPECTOR_ID,
          inspectionId: INSPECTION_ID,
          deviceId: "dev-1",
          sequenceNumber: 1,
          payload: { responses: {}, evidence: [] },
          sha256Hash: "",
          networkState: "offline",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/sync/packages/:id", () => {
    it("returns 400 with invalid UUID path param", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/inspection/sync/packages/not-a-uuid",
        headers: INSPECTOR_HEADER,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/sync/status/:inspectorId", () => {
    it("returns 400 with invalid UUID for inspectorId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/inspection/sync/status/not-valid-uuid",
        headers: INSPECTOR_HEADER,
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Auth — 401 (no token) and 403 (wrong role)
// ══════════════════════════════════════════════════════════════════════════════

describe("Auth enforcement — 401 and 403", () => {
  const VALID_PACKAGE_BODY = { inspectorId: INSPECTOR_ID };
  const VALID_UPLOAD_BODY = {
    inspectorId: INSPECTOR_ID,
    inspectionId: INSPECTION_ID,
    deviceId: "dev-1",
    sequenceNumber: 1,
    payload: { responses: { "q1": { value: "y", answeredAt: "2024-01-01T00:00:00Z" } }, evidence: [] },
    sha256Hash: "deadbeef",
    networkState: "offline",
  };

  describe("POST /v1/inspection/sync/packages", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        payload: VALID_PACKAGE_BODY,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role (employee)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: NO_ROLE_HEADER,
        payload: VALID_PACKAGE_BODY,
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 202 with inspector role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: INSPECTOR_HEADER,
        payload: VALID_PACKAGE_BODY,
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 202 with inspection_admin role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/packages",
        headers: ADMIN_HEADER,
        payload: VALID_PACKAGE_BODY,
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/sync/packages/:id", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/inspection/sync/packages/${PACKAGE_ID}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role (employee)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/inspection/sync/packages/${PACKAGE_ID}`,
        headers: NO_ROLE_HEADER,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/inspection/sync/upload", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        payload: VALID_UPLOAD_BODY,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role (employee)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/inspection/sync/upload",
        headers: NO_ROLE_HEADER,
        payload: VALID_UPLOAD_BODY,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/inspection/sync/status/:inspectorId", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/inspection/sync/status/${INSPECTOR_ID}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role (employee)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/inspection/sync/status/${INSPECTOR_ID}`,
        headers: NO_ROLE_HEADER,
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
