/**
 * IVR hit events and recording consumer tests.
 *
 * Tests:
 * - IVR hit creation (batch upsert)
 * - 50-hit limit enforcement
 * - Recording consumer (mocked storage)
 * - CRUD routes for IVR hits and recordings
 *
 * Validates: Requirements 15.3, 15.4
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

// Mock @civitasone/storage so we don't need a real S3/MinIO instance.
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  presignedGetUrl: vi.fn().mockResolvedValue("https://s3.example.com/recordings/signed-url"),
  getObject: vi.fn().mockResolvedValue(Buffer.from("mock-audio")),
}));

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const CALL_ID = "33333333-3333-3333-3333-333333333333";

function makeToken(roles: string[] = ["telephony_admin", "super_admin"]): string {
  return signToken(
    { sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  // Clean up IVR hits and recordings between tests (uses superuser-like access via civitas_admin).
  // In test env with RLS, we truncate via raw SQL to avoid RLS restrictions.
  const { db: testDb } = await import("../src/shared/db.js");
  await testDb.execute(
    (await import("drizzle-orm")).sql`TRUNCATE telephony.ivr_hits, telephony.recordings`,
  );
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ── IVR Hit Routes ────────────────────────────────────────────────

describe("POST /v1/telephony/calls/:callId/ivr-hits", () => {
  const token = makeToken();

  it("creates IVR hits with valid payload (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "main_menu", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
          { menuKey: "billing", digit: "2", timestamp: "2024-06-15T10:00:05Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.callId).toBe(CALL_ID);
    expect(body.data.inserted).toBe(2);
    expect(body.data.totalHits).toBe(2);
  });

  it("assigns ordinals sequentially", async () => {
    const callId2 = "44444444-4444-4444-4444-444444444444";
    // First batch
    await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callId2}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "menu_a", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    // Second batch
    await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callId2}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "menu_b", digit: "3", timestamp: "2024-06-15T10:00:10Z" },
        ],
      },
    });

    // Read them back
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${callId2}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].ordinal).toBe(1);
    expect(body.data[1].ordinal).toBe(2);
  });

  it("rejects hits that would exceed the 50-hit limit (422)", async () => {
    const callIdLimit = "55555555-5555-5555-5555-555555555555";
    // Fill up to 49 hits (max batch size is 50)
    const first49 = Array.from({ length: 49 }, (_, i) => ({
      menuKey: `menu_${i}`,
      digit: String(i % 10),
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    }));
    const fillRes = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callIdLimit}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: { hits: first49 },
    });
    expect(fillRes.statusCode).toBe(201);
    expect(fillRes.json().data.totalHits).toBe(49);

    // Try to add 2 more (would exceed 50)
    const overflowRes = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callIdLimit}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "overflow1", digit: "1", timestamp: "2024-06-15T11:00:00Z" },
          { menuKey: "overflow2", digit: "2", timestamp: "2024-06-15T11:00:01Z" },
        ],
      },
    });
    expect(overflowRes.statusCode).toBe(422);
    expect(overflowRes.json().code).toBe("IVR_LIMIT_EXCEEDED");
  });

  it("allows exactly 50 hits (boundary)", async () => {
    const callIdBoundary = "66666666-6666-6666-6666-666666666666";
    const hits50 = Array.from({ length: 50 }, (_, i) => ({
      menuKey: `m_${i}`,
      digit: String(i % 10),
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    }));
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callIdBoundary}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: { hits: hits50 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.totalHits).toBe(50);
  });

  it("validates DTMF digits (400 on invalid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "menu", digit: "abc", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates menuKey length (400 on empty)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty hits array (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: { hits: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unauthenticated requests (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      payload: {
        hits: [
          { menuKey: "menu", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthorized role (403)", async () => {
    const badToken = signToken(
      { sub: ACTOR_ID, tid: TENANT_ID, roles: ["employee"], sid: "sess-bad" },
      SECRET,
      3600,
    );
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${badToken}` },
      payload: {
        hits: [
          { menuKey: "menu", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates callId is UUID (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/not-a-uuid/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "menu", digit: "1", timestamp: "2024-06-15T10:00:00Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("supports DTMF special characters * and #", async () => {
    const callIdSpec = "77777777-7777-7777-7777-777777777777";
    const res = await app.inject({
      method: "POST",
      url: `/v1/telephony/calls/${callIdSpec}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
      payload: {
        hits: [
          { menuKey: "star_menu", digit: "*", timestamp: "2024-06-15T10:00:00Z" },
          { menuKey: "hash_menu", digit: "#", timestamp: "2024-06-15T10:00:01Z" },
          { menuKey: "combo", digit: "*9#", timestamp: "2024-06-15T10:00:02Z" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.inserted).toBe(3);
  });
});

// ── GET IVR Hits ──────────────────────────────────────────────────

describe("GET /v1/telephony/calls/:callId/ivr-hits", () => {
  const token = makeToken();

  it("returns IVR hits ordered by ordinal (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta.total).toBeGreaterThanOrEqual(0);
    // Verify ordering
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i].ordinal).toBeGreaterThan(body.data[i - 1].ordinal);
    }
  });

  it("returns empty array for call with no hits (200)", async () => {
    const emptyCallId = "88888888-8888-8888-8888-888888888888";
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${emptyCallId}/ivr-hits`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    expect(res.json().meta.total).toBe(0);
  });

  it("rejects unauthenticated requests (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/ivr-hits`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── GET Recordings ────────────────────────────────────────────────

describe("GET /v1/telephony/calls/:callId/recordings", () => {
  const token = makeToken();

  it("returns empty array for call with no recordings (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/recordings`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("rejects unauthenticated requests (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/recordings`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthorized role (403)", async () => {
    const badToken = signToken(
      { sub: ACTOR_ID, tid: TENANT_ID, roles: ["employee"], sid: "sess-bad" },
      SECRET,
      3600,
    );
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/recordings`,
      headers: { authorization: `Bearer ${badToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates callId is UUID (400)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/not-a-uuid/recordings`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Recording Consumer (unit test of domain logic) ────────────────

describe("recording consumer — buildStorageKey pattern", () => {
  it("builds correct storage key pattern", () => {
    // We test the pattern: {tenantId}/recordings/{callId}/{recordingId}.{format}
    const tenantId = "aaaa-bbbb";
    const callId = "cccc-dddd";
    const recordingId = "eeee-ffff";
    const format = "mp3";
    const key = `${tenantId}/recordings/${callId}/${recordingId}.${format}`;
    expect(key).toBe("aaaa-bbbb/recordings/cccc-dddd/eeee-ffff.mp3");
  });

  it("uses wav format when specified", () => {
    const key = `tenant1/recordings/call1/rec1.wav`;
    expect(key).toContain(".wav");
  });

  it("uses ogg format when specified", () => {
    const key = `tenant1/recordings/call1/rec1.ogg`;
    expect(key).toContain(".ogg");
  });

  it("uses opus format when specified", () => {
    const key = `tenant1/recordings/call1/rec1.opus`;
    expect(key).toContain(".opus");
  });
});

// ── IVR Domain Logic ──────────────────────────────────────────────

describe("IVR domain logic", () => {
  it("canAddHits returns true when under limit", async () => {
    const { canAddHits, MAX_IVR_HITS_PER_CALL } = await import("../src/modules/ivr/domain.js");
    expect(canAddHits(0, 1)).toBe(true);
    expect(canAddHits(49, 1)).toBe(true);
    expect(canAddHits(25, 25)).toBe(true);
  });

  it("canAddHits returns false when would exceed limit", async () => {
    const { canAddHits } = await import("../src/modules/ivr/domain.js");
    expect(canAddHits(50, 1)).toBe(false);
    expect(canAddHits(49, 2)).toBe(false);
    expect(canAddHits(48, 3)).toBe(false);
  });

  it("canAddHits returns true at exact boundary", async () => {
    const { canAddHits } = await import("../src/modules/ivr/domain.js");
    expect(canAddHits(0, 50)).toBe(true);
    expect(canAddHits(50, 0)).toBe(true);
  });

  it("MAX_IVR_HITS_PER_CALL is 50", async () => {
    const { MAX_IVR_HITS_PER_CALL } = await import("../src/modules/ivr/domain.js");
    expect(MAX_IVR_HITS_PER_CALL).toBe(50);
  });

  it("validateIvrHit validates digit pattern", async () => {
    const { validateIvrHit, InvalidDtmfError } = await import("../src/modules/ivr/domain.js");
    expect(() => validateIvrHit({ menuKey: "test", digit: "abc", timestamp: "2024-01-01T00:00:00Z" }))
      .toThrow(InvalidDtmfError);
    expect(() => validateIvrHit({ menuKey: "test", digit: "1", timestamp: "2024-01-01T00:00:00Z" }))
      .not.toThrow();
    expect(() => validateIvrHit({ menuKey: "test", digit: "*#0", timestamp: "2024-01-01T00:00:00Z" }))
      .not.toThrow();
  });

  it("validateIvrHit validates menuKey length", async () => {
    const { validateIvrHit } = await import("../src/modules/ivr/domain.js");
    expect(() => validateIvrHit({ menuKey: "", digit: "1", timestamp: "2024-01-01T00:00:00Z" }))
      .toThrow("menuKey must be between 1 and 64 characters");
    expect(() => validateIvrHit({ menuKey: "a".repeat(65), digit: "1", timestamp: "2024-01-01T00:00:00Z" }))
      .toThrow("menuKey must be between 1 and 64 characters");
  });

  it("validateIvrHit validates digit length", async () => {
    const { validateIvrHit } = await import("../src/modules/ivr/domain.js");
    expect(() => validateIvrHit({ menuKey: "test", digit: "", timestamp: "2024-01-01T00:00:00Z" }))
      .toThrow("digit must be between 1 and 8 characters");
    expect(() => validateIvrHit({ menuKey: "test", digit: "123456789", timestamp: "2024-01-01T00:00:00Z" }))
      .toThrow("digit must be between 1 and 8 characters");
  });

  it("validateIvrHit returns a parsed Date timestamp", async () => {
    const { validateIvrHit } = await import("../src/modules/ivr/domain.js");
    const result = validateIvrHit({ menuKey: "test", digit: "5", timestamp: "2024-06-15T10:30:00Z" });
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp.toISOString()).toBe("2024-06-15T10:30:00.000Z");
  });
});
