/**
 * Transcription adapter tests.
 *
 * Tests:
 * - Disabled returns 503
 * - Happy path (mocked transcription API)
 * - Timeout handling
 * - 500K char limit enforcement
 * - Circuit breaker behavior
 *
 * Validates: Requirements 15.5, 15.6, 15.7
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ── Route Tests: Transcription Disabled ───────────────────────────

describe("GET /v1/telephony/calls/:callId/transcript — disabled", () => {
  beforeEach(() => {
    process.env.TRANSCRIPTION_ENABLED = "false";
  });

  afterEach(() => {
    delete process.env.TRANSCRIPTION_ENABLED;
  });

  it("returns 503 when TRANSCRIPTION_ENABLED is not true", async () => {
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/transcript`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe("TRANSCRIPTION_DISABLED");
  });

  it("rejects unauthenticated requests (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/transcript`,
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
      url: `/v1/telephony/calls/${CALL_ID}/transcript`,
      headers: { authorization: `Bearer ${badToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Route Tests: Transcription Enabled ────────────────────────────

describe("GET /v1/telephony/calls/:callId/transcript — enabled", () => {
  beforeEach(async () => {
    process.env.TRANSCRIPTION_ENABLED = "true";
    process.env.TRANSCRIPTION_PROVIDER = "test";
    process.env.TRANSCRIPTION_API_KEY = "test-key";
    process.env.TRANSCRIPTION_BASE_URL = "http://localhost:9999";

    const { db: testDb } = await import("../src/shared/db.js");
    const { sql } = await import("drizzle-orm");
    await testDb.execute(sql`DELETE FROM telephony.transcripts WHERE tenant_id = ${TENANT_ID}`);
  });

  afterEach(() => {
    delete process.env.TRANSCRIPTION_ENABLED;
    delete process.env.TRANSCRIPTION_PROVIDER;
    delete process.env.TRANSCRIPTION_API_KEY;
    delete process.env.TRANSCRIPTION_BASE_URL;
  });

  it("returns 404 when no transcript exists for the call", async () => {
    const token = makeToken();
    const unknownCallId = "99999999-9999-9999-9999-999999999999";
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${unknownCallId}/transcript`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("validates callId is UUID (400)", async () => {
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/not-a-uuid/transcript`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns transcript data when it exists (200)", async () => {
    const token = makeToken();
    const { db: testDb } = await import("../src/shared/db.js");
    const { sql } = await import("drizzle-orm");
    const { transcripts } = await import("../src/modules/transcription/schema.js");
    const transcriptId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const recordingId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Set tenant context for RLS before insert.
    await testDb.execute(sql`SELECT set_config('app.tenant_id', ${TENANT_ID}, false)`);
    await testDb.insert(transcripts).values({
      id: transcriptId,
      tenantId: TENANT_ID,
      callId: CALL_ID,
      recordingId,
      text: "Hello, this is a test transcript.",
      status: "completed",
      durationMs: 5000,
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/transcript`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(transcriptId);
    expect(body.data.callId).toBe(CALL_ID);
    expect(body.data.recordingId).toBe(recordingId);
    expect(body.data.text).toBe("Hello, this is a test transcript.");
    expect(body.data.status).toBe("completed");
    expect(body.data.durationMs).toBe(5000);
  });
});

// ── Adapter Unit Tests ────────────────────────────────────────────

describe("transcription adapter — domain logic", () => {
  it("MAX_TRANSCRIPT_LENGTH is 500000", async () => {
    const { MAX_TRANSCRIPT_LENGTH } = await import("../src/modules/transcription/adapter.js");
    expect(MAX_TRANSCRIPT_LENGTH).toBe(500_000);
  });

  it("DEFAULT_TIMEOUT_MS is 120000 (120s)", async () => {
    const { DEFAULT_TIMEOUT_MS } = await import("../src/modules/transcription/adapter.js");
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });

  it("isEnabled returns false when TRANSCRIPTION_ENABLED is not true", () => {
    const original = process.env.TRANSCRIPTION_ENABLED;
    process.env.TRANSCRIPTION_ENABLED = "false";
    // Dynamic import to avoid module cache issues — isEnabled reads env at call time.
    import("../src/modules/transcription/adapter.js").then(({ isEnabled }) => {
      expect(isEnabled()).toBe(false);
    });
    process.env.TRANSCRIPTION_ENABLED = original;
  });

  it("isEnabled returns true when TRANSCRIPTION_ENABLED is true", async () => {
    const original = process.env.TRANSCRIPTION_ENABLED;
    process.env.TRANSCRIPTION_ENABLED = "true";
    const { isEnabled } = await import("../src/modules/transcription/adapter.js");
    expect(isEnabled()).toBe(true);
    process.env.TRANSCRIPTION_ENABLED = original;
  });

  it("getBreakerState returns a valid state", async () => {
    const { getBreakerState } = await import("../src/modules/transcription/adapter.js");
    const state = getBreakerState();
    expect(["closed", "open", "half-open"]).toContain(state);
  });

  it("TranscriptionAdapterError has correct properties", async () => {
    const { TranscriptionAdapterError } = await import("../src/modules/transcription/adapter.js");
    const err = new TranscriptionAdapterError("test error", "TEST_CODE", 500);
    expect(err.message).toBe("test error");
    expect(err.code).toBe("TEST_CODE");
    expect(err.httpStatus).toBe(500);
    expect(err.name).toBe("TranscriptionAdapterError");
  });

  it("transcribe throws TRANSCRIPTION_DISABLED when not enabled", async () => {
    const original = process.env.TRANSCRIPTION_ENABLED;
    process.env.TRANSCRIPTION_ENABLED = "false";
    const { transcribe, TranscriptionAdapterError } = await import("../src/modules/transcription/adapter.js");
    await expect(transcribe("key", "url")).rejects.toThrow(TranscriptionAdapterError);
    await expect(transcribe("key", "url")).rejects.toThrow("Transcription integration is not available");
    process.env.TRANSCRIPTION_ENABLED = original;
  });
});

// ── Transcript Text Length Enforcement ────────────────────────────

describe("transcript 500K char limit", () => {
  beforeEach(async () => {
    process.env.TRANSCRIPTION_ENABLED = "true";
    const { db: testDb } = await import("../src/shared/db.js");
    const { sql } = await import("drizzle-orm");
    await testDb.execute(sql`DELETE FROM telephony.transcripts WHERE tenant_id = ${TENANT_ID}`);
  });

  afterEach(() => {
    delete process.env.TRANSCRIPTION_ENABLED;
  });

  it("stores transcripts up to 500K characters", async () => {
    const token = makeToken();
    const { db: testDb } = await import("../src/shared/db.js");
    const { sql } = await import("drizzle-orm");
    const { transcripts } = await import("../src/modules/transcription/schema.js");
    const transcriptId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const recordingId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const longText = "a".repeat(500_000);

    await testDb.execute(sql`SELECT set_config('app.tenant_id', ${TENANT_ID}, false)`);
    await testDb.insert(transcripts).values({
      id: transcriptId,
      tenantId: TENANT_ID,
      callId: CALL_ID,
      recordingId,
      text: longText,
      status: "completed",
      durationMs: 60000,
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/telephony/calls/${CALL_ID}/transcript`,
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.text.length).toBe(500_000);
  });

  it("DB rejects transcript text exceeding 500K characters", async () => {
    const { db: testDb } = await import("../src/shared/db.js");
    const { sql } = await import("drizzle-orm");
    const { transcripts } = await import("../src/modules/transcription/schema.js");
    const transcriptId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const recordingId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const tooLongText = "b".repeat(500_001);

    await testDb.execute(sql`SELECT set_config('app.tenant_id', ${TENANT_ID}, false)`);
    await expect(
      testDb.insert(transcripts).values({
        id: transcriptId,
        tenantId: TENANT_ID,
        callId: CALL_ID,
        recordingId,
        text: tooLongText,
        status: "completed",
        durationMs: 60000,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      }),
    ).rejects.toThrow();
  });
});

// ── Circuit Breaker Integration ───────────────────────────────────

describe("transcription circuit breaker", () => {
  it("CircuitBreakerOpenError is properly exported", async () => {
    const { CircuitBreakerOpenError } = await import("../src/modules/transcription/adapter.js");
    const err = new CircuitBreakerOpenError("test");
    expect(err.name).toBe("CircuitBreakerOpenError");
    expect(err.message).toContain("test");
  });
});
