/**
 * UAT B10-F83 (consumer half): permanent versus retryable ingest failures.
 *
 * A message that can never be stored is rejected ONCE with NonRetryableError
 * (dead-lettered with its reason) instead of being retried to the DLQ like an
 * outage; a transient failure stays retryable so the message is redelivered,
 * and the message is only acknowledged after the audit row has committed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NonRetryableError, type Queue } from "@civitasone/queue";

const dbm = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbm.transaction }, sqlClient: { end: vi.fn() } }));

// eslint-disable-next-line import/first
import { registerAuditConsumers, assertIngestable } from "../src/modules/events/consumer.js";

type H = (msg: Record<string, unknown>) => Promise<void>;
function capture(): Record<string, H> {
  const handlers: Record<string, H> = {};
  const q = { subscribe: (topic: string, h: H) => { handlers[topic] = h; } } as unknown as Queue;
  registerAuditConsumers(q);
  return handlers;
}
const good = () => ({
  messageId: randomUUID(), type: "audit.event.record", tenantId: randomUUID(), actorId: randomUUID(),
  correlationId: randomUUID(), schemaVersion: "1.0",
  payload: { service: "revenue", action: "decide", resourceType: "refund", resourceId: randomUUID(), outcome: "approved" },
});

beforeEach(() => { dbm.transaction.mockReset(); });

describe("UAT B10-F83 audit ingest: NonRetryable versus retryable", () => {
  it.each([
    ["tenant not a uuid", { tenantId: "system" }, "AUDIT_INVALID_TENANT"],
    ["actor not a uuid", { actorId: "bulk-scan-sweeper" }, "AUDIT_INVALID_ACTOR"],
    ["payload not an object", { payload: null }, "AUDIT_INVALID_PAYLOAD"],
    ["resourceId not a string", { payload: { action: "x", resourceId: 42 } }, "AUDIT_INVALID_RESOURCE_ID"],
    ["resourceId over 256 chars", { payload: { action: "x", resourceId: "r".repeat(257) } }, "AUDIT_INVALID_RESOURCE_ID"],
  ])("%s is rejected once, before any DB work", async (_label, patch, code) => {
    const h = capture()["audit.event.record"]!;
    const err = await h({ ...good(), ...patch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String((err as Error).message)).toContain(code);
    expect(dbm.transaction).not.toHaveBeenCalled();
  });

  it("a Postgres data/integrity error (22xxx/23xxx) is permanent: NonRetryableError", async () => {
    dbm.transaction.mockRejectedValueOnce(Object.assign(new Error("value too long for type character varying(128)"), { code: "22001" }));
    const err = await capture()["audit.event.ingest"]!(good()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String((err as Error).message)).toContain("AUDIT_INGEST_REJECTED");
  });

  it("a transient failure (connection refused, deadlock) stays retryable, so the message is redelivered", async () => {
    for (const e of [Object.assign(new Error("connect ECONNREFUSED db.internal:5432"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("deadlock detected"), { code: "40P01" })]) {
      dbm.transaction.mockRejectedValueOnce(e);
      const err = await capture()["audit.event.record"]!(good()).catch((x: unknown) => x);
      expect(err).toBe(e);
      expect(err).not.toBeInstanceOf(NonRetryableError);
    }
  });

  it("a valid event goes to the DB transaction (acknowledged only after it commits)", async () => {
    dbm.transaction.mockResolvedValueOnce(undefined);
    await expect(capture()["audit.event.record"]!(good())).resolves.toBeUndefined();
    expect(dbm.transaction).toHaveBeenCalledTimes(1);
  });

  it("assertIngestable accepts a well-formed event without a resourceId (legacy producers)", () => {
    const m = good();
    delete (m.payload as Record<string, unknown>).resourceId;
    expect(() => assertIngestable(m)).not.toThrow();
  });
});
