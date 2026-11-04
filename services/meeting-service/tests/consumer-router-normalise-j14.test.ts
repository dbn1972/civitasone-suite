/**
 * UAT J14: the meeting worker logged the J14 "Schedule" dead letter as
 * { type: "string", message: "non-Error value thrown" }. worker.ts passed err.stack (a string)
 * as the pino `err` field, and SAFE_LOG_SERIALIZERS reduces anything that is not an Error to
 * that placeholder, so the real cause (a NonRetryableError: actor lacks ownership standing) was
 * only visible in the pm2 error log. The retry + dead-letter router now lives in
 * shared/consumer-router.ts: every thrown value is normalised into an Error that keeps the
 * original details, validation and business-rule failures are classified non-retryable
 * (dead-lettered after one attempt), and the dead letter is handed back to the bus as a
 * NonRetryableError so the original message is parked in the topic DLQ instead of being acked.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pino } from "pino";
import { z } from "zod";
import { NonRetryableError, isNonRetryable, type CommandEnvelope } from "@civitasone/queue";
import { SAFE_LOG_SERIALIZERS } from "@civitasone/observability";
import { HttpError } from "../src/shared/context.js";
import { VersionConflictError } from "../src/shared/outbox.js";
import { makeConsumerRouter, normaliseThrown, classifyConsumerFailure, NonErrorThrown, ReducedDatabaseError } from "../src/shared/consumer-router.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

const TOPIC = "meeting.meeting.transition";
const MSG = {
  messageId: "390d380f-d80f-457a-88a1-16f9eb89c601",
  type: TOPIC,
  tenantId: "11111111-0000-0000-0000-000000000001",
  actorId: "82310d88-a7e7-440d-95b5-b40fd1898232",
  correlationId: "68c7b925-1005-48c8-8630-42e164c75188",
  schemaVersion: "1.0",
  payload: { meetingId: "4d88f4de-caa5-75e9-b0bc-0094d9ece39e", version: 1, to: "scheduled" },
} as unknown as CommandEnvelope;

type Dead = { topic: string; err: Error; attempts: number };

/** Drive the router once with a handler that throws `thrown`; return the dead letter and what the router rethrew. */
async function runWith(thrown: () => unknown): Promise<{ dead: Dead[]; calls: number; rethrown: unknown }> {
  const dead: Dead[] = [];
  let calls = 0;
  const router = makeConsumerRouter({
    topic: TOPIC,
    getHandler: () => async () => {
      calls += 1;
      throw thrown();
    },
    runInTenant: async (_t, fn) => { await fn(); },
    deadLetter: async (topic, _msg, err, attempts) => { dead.push({ topic, err, attempts }); },
    onMissingHandler: () => undefined,
    maxAttempts: 3,
    backoffMs: [0, 0, 0],
    sleep: async () => undefined,
  });
  let rethrown: unknown;
  try { await router(MSG); } catch (e) { rethrown = e; }
  return { dead, calls, rethrown };
}

function logLine(err: unknown): Record<string, unknown> {
  const lines: string[] = [];
  const log = pino({ serializers: SAFE_LOG_SERIALIZERS }, new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } }));
  log.error({ err }, "consumer failed");
  return JSON.parse(lines[0]!).err as Record<string, unknown>;
}

describe("normaliseThrown: every thrown value becomes an Error with its details (UAT J14)", () => {
  it("keeps an Error as it is", () => {
    const e = new Error("x");
    expect(normaliseThrown(e)).toBe(e);
  });

  it("a thrown string becomes an Error whose message is the string", () => {
    const e = normaliseThrown("agenda must have at least one item");
    expect(e).toBeInstanceOf(NonErrorThrown);
    expect(e.message).toBe("agenda must have at least one item");
    expect((e as NonErrorThrown).thrownType).toBe("string");
  });

  it("a plain object keeps only its status / code values and its key names (#2452 review)", () => {
    const e = normaliseThrown({ status: 422, code: "MEETING_INVALID_TRANSITION", message: "cannot schedule", details: { unmet: ["agendaItem"] } });
    expect(e).toBeInstanceOf(NonErrorThrown);
    expect((e as unknown as { status: number }).status).toBe(422);
    expect((e as unknown as { code: string }).code).toBe("MEETING_INVALID_TRANSITION");
    expect(e.message).toBe("non-Error object thrown (status 422, code MEETING_INVALID_TRANSITION; keys: status, code, message, details)");
    expect((e as NonErrorThrown).details).toEqual({ keys: ["status", "code", "message", "details"], status: 422, code: "MEETING_INVALID_TRANSITION" });
    const line = JSON.stringify(logLine(e));
    expect(line).not.toContain("cannot schedule");
    expect(line).not.toContain("agendaItem");
  });

  it("a plain object carrying a row is logged without any row value (#2452 review)", async () => {
    const thrown = () => ({ code: "ROW_REJECTED", row: { name: "Kumari Sensitive", pan: "QWERT6789Z", bank: "000123456789" }, message: "row Kumari Sensitive rejected" });
    const e = normaliseThrown(thrown());
    const r = await runWith(thrown);
    for (const out of [JSON.stringify(logLine(e)), JSON.stringify(logLine(r.dead[0]!.err)), String((r.rethrown as Error).stack), (r.rethrown as Error).message]) {
      expect(out).not.toContain("Kumari");
      expect(out).not.toContain("QWERT6789Z");
      expect(out).not.toContain("000123456789");
    }
    expect(e.message).toContain("code ROW_REJECTED");
    expect(e.message).toContain("keys: code, row, message");
  });

  it("a code / status value that is not a plain token is not carried", () => {
    const e = normaliseThrown({ code: "Kumari Sensitive QWERT6789Z", status: "x" });
    expect(e.message).not.toContain("Kumari");
    expect((e as unknown as { code?: unknown }).code).toBeUndefined();
  });

  it("a real 22P02 error with the input value in its message is logged without the value (#2452 review)", async () => {
    const VALUE = "Kumari-QWERT6789Z";
    let caught: unknown;
    try { await sqlClient.unsafe("select $1::uuid as id", [VALUE] as never[]); } catch (err) { caught = err; }
    // Control: the raw driver error really carries the value in its message.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(VALUE);
    expect((caught as { code: string }).code).toBe("22P02");

    const e = normaliseThrown(caught);
    expect(e).toBeInstanceOf(ReducedDatabaseError);
    expect(e.message).toBe("database error 22P02");
    expect((e as ReducedDatabaseError).code).toBe("22P02");
    expect((e as { cause?: unknown }).cause).toBeUndefined();

    // Through the router: non-retryable, and neither the dead letter, its log line, the rethrown
    // error message nor its stack (what the bus console-logs) carries the value.
    const r = await runWith(() => caught);
    expect(r.calls).toBe(1);
    expect(r.rethrown).toBeInstanceOf(NonRetryableError);
    for (const out of [e.message, String(e.stack), JSON.stringify(logLine(e)), JSON.stringify(logLine(r.dead[0]!.err)),
      (r.rethrown as Error).message, String((r.rethrown as Error).stack), JSON.stringify(logLine(r.rethrown))]) {
      expect(out).not.toContain(VALUE);
      expect(out).not.toContain("QWERT6789Z");
    }
    expect(JSON.stringify(logLine(r.dead[0]!.err))).toContain("22P02");
  });

  it("an Error or NonRetryableError that embeds a DB error message is reduced too, and stays non-retryable", () => {
    const pg = Object.assign(new Error("invalid input syntax for type uuid: \"Kumari-QWERT6789Z\""), { name: "PostgresError", code: "22P02", routine: "string_to_uuid" });
    const wrapped = new NonRetryableError(pg.message, pg);
    const c = classifyConsumerFailure(wrapped);
    expect(isNonRetryable(c)).toBe(true);
    expect(c.message).toBe("database error 22P02");
    expect(JSON.stringify(logLine(c))).not.toContain("Kumari");
    const plainWrap = new Error(`insert failed: ${pg.message}`, { cause: pg });
    expect(normaliseThrown(plainWrap).message).toBe("database error 22P02");
  });

  it("a plain Postgres error object is reduced to code / constraint, never its parameters", () => {
    const e = normaliseThrown({ name: "PostgresError", code: "23514", constraint_name: "meetings_status_check", query: "update ...", parameters: ["Kumari Sensitive"] });
    expect(e.message).toBe("database error 23514 on meetings_status_check");
    expect((e as unknown as { code: string }).code).toBe("23514");
    expect(JSON.stringify(logLine(e))).not.toContain("Kumari");
  });

  it("undefined / null / numbers get a readable message", () => {
    expect(normaliseThrown(undefined).message).toBe("non-Error value thrown: undefined");
    expect(normaliseThrown(null).message).toBe("non-Error value thrown: null");
    expect(normaliseThrown(42).message).toBe("non-Error value thrown: 42");
  });

  it("the safe log serializer shows the real message for a normalised value, not the placeholder", () => {
    const out = logLine(normaliseThrown("lacks ownership standing"));
    expect(out.message).toBe("lacks ownership standing");
    expect(out.message).not.toBe("non-Error value thrown");
    expect(out.type).toBe("NonErrorThrown");
  });
});

describe("classifyConsumerFailure: validation and business-rule failures are non-retryable", () => {
  const permanent: Array<[string, () => unknown]> = [
    ["NonRetryableError", () => new NonRetryableError("bad transition")],
    ["HttpError 403 (ownership)", () => new HttpError(403, "FORBIDDEN", "lacks ownership standing")],
    ["HttpError 422 (state machine guard)", () => new HttpError(422, "MEETING_INVALID_TRANSITION", "cannot schedule")],
    ["ZodError (validation)", () => { try { z.object({ to: z.string() }).parse({}); } catch (e) { return e; } return null; }],
    ["VersionConflictError (stale version)", () => new VersionConflictError("meeting", "4d88f4de-caa5-75e9-b0bc-0094d9ece39e", 1)],
    ["CHECK violation 23514", () => Object.assign(new Error("check"), { name: "PostgresError", code: "23514", routine: "ExecConstraints" })],
    ["NOT NULL violation 23502", () => Object.assign(new Error("nn"), { name: "PostgresError", code: "23502", routine: "ExecConstraints" })],
    ["data exception 22P02", () => Object.assign(new Error("bad uuid"), { name: "PostgresError", code: "22P02", routine: "string_to_uuid" })],
    ["plain object with status 422", () => ({ status: 422, code: "MEETING_INVALID_TRANSITION", message: "cannot schedule" })],
  ];
  for (const [name, make] of permanent) {
    it(`${name} is dead-lettered after one attempt`, async () => {
      expect(isNonRetryable(classifyConsumerFailure(make()))).toBe(true);
      const r = await runWith(make);
      expect(r.calls).toBe(1);
      expect(r.dead).toHaveLength(1);
      expect(r.dead[0]!.attempts).toBe(1);
      expect(r.dead[0]!.err).toBeInstanceOf(Error);
    });
  }

  const transient: Array<[string, () => unknown]> = [
    ["a plain Error (connection reset)", () => new Error("ECONNRESET")],
    ["serialization failure 40001", () => Object.assign(new Error("ser"), { name: "PostgresError", code: "40001", routine: "x" })],
    ["undefined table 42P01 (deploy window)", () => Object.assign(new Error("rel"), { name: "PostgresError", code: "42P01", routine: "parserOpenTable" })],
    ["HttpError 503", () => new HttpError(503, "SERVICE_UNAVAILABLE", "down")],
    ["a thrown string", () => "socket hang up"],
  ];
  for (const [name, make] of transient) {
    it(`${name} is retried 3 times, then dead-lettered`, async () => {
      expect(isNonRetryable(classifyConsumerFailure(make()))).toBe(false);
      const r = await runWith(make);
      expect(r.calls).toBe(3);
      expect(r.dead).toHaveLength(1);
      expect(r.dead[0]!.attempts).toBe(3);
    });
  }
});

describe("makeConsumerRouter dead-letter path (UAT J14)", () => {
  it("a non-Error throw reaches deadLetter as an Error carrying the original text", async () => {
    const r = await runWith(() => "actor lacks ownership standing over meeting 4d88f4de");
    expect(r.dead[0]!.err).toBeInstanceOf(NonErrorThrown);
    expect(r.dead[0]!.err.message).toBe("actor lacks ownership standing over meeting 4d88f4de");
    expect(logLine(r.dead[0]!.err).message).toBe("actor lacks ownership standing over meeting 4d88f4de");
  });

  it("hands the dead letter back to the bus as a NonRetryableError (parked in the topic DLQ, not acked)", async () => {
    const r = await runWith(() => new HttpError(403, "FORBIDDEN", "lacks ownership standing"));
    expect(r.rethrown).toBeInstanceOf(NonRetryableError);
    expect((r.rethrown as Error).message).toBe("lacks ownership standing");
    const t = await runWith(() => "socket hang up");
    expect(t.rethrown).toBeInstanceOf(NonRetryableError);
  });

  it("a successful handler is neither dead-lettered nor rethrown", async () => {
    const dead: Dead[] = [];
    const router = makeConsumerRouter({
      topic: TOPIC,
      getHandler: () => async () => undefined,
      runInTenant: async (_t, fn) => { await fn(); },
      deadLetter: async (topic, _m, err, attempts) => { dead.push({ topic, err, attempts }); },
      onMissingHandler: () => undefined,
      maxAttempts: 3,
      backoffMs: [0],
      sleep: async () => undefined,
    });
    await expect(router(MSG)).resolves.toBeUndefined();
    expect(dead).toEqual([]);
  });

  it("worker.ts routes through makeConsumerRouter and logs the Error itself, not its stack string", () => {
    const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toContain("makeConsumerRouter(");
    expect(src).not.toMatch(/err:\s*err instanceof Error \? err\.stack/);
  });
});
