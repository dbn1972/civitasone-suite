/**
 * V4-G-09 -- citizen.refund.approved -> GL reversal (Dr revenue head / Cr bank), so revenue is not
 * left overstated after an approved refund.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NonRetryableError } from "@civitasone/queue";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Handler = (msg: unknown) => Promise<void>;
class TestMemoryQueue {
  handlers = new Map<string, Handler[]>();
  async publish(topic: string, msg: Record<string, unknown>): Promise<void> {
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
  }
  subscribe(topic: string, handler: Handler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }
}

const m = vi.hoisted(() => ({
  enqueue: vi.fn(async (..._a: unknown[]) => undefined),
  markProcessed: vi.fn(async () => true),
  findHeadByCodeTx: vi.fn(),
  spine: vi.fn(async (..._a: unknown[]) => "journal-id"),
  captureError: vi.fn(),
}));

vi.mock("../../shared/db.js", () => {
  const tx = async (cb: (t: unknown) => Promise<void>) => { await cb({}); };
  return { scopedRead: tx, db: { transaction: tx } };
});
vi.mock("../../shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));
vi.mock("../../shared/infra.js", () => ({ cache: { invalidateResource: vi.fn(async () => undefined) } }));
vi.mock("../budget/repo.js", () => ({ findHeadByCodeTx: m.findHeadByCodeTx }));
vi.mock("../gl/spine.js", () => ({ enqueueSpineJournal: m.spine }));
vi.mock("@civitasone/observability", () => ({ captureError: m.captureError }));

import { registerRevenueGlConsumers } from "./consumer.js";

const TOPIC = "citizen.refund.approved";
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

function msg(payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type: TOPIC, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
function allowedJournalTypes(): Set<string> {
  let latest: string[] = [];
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const at = sql.indexOf("ADD CONSTRAINT finance_journals_type_check");
    if (at === -1) continue;
    const list = /CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)/s.exec(sql.slice(at));
    if (list) latest = [...list[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  }
  return new Set(latest);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.markProcessed.mockResolvedValue(true);
  m.findHeadByCodeTx.mockImplementation(async (_tx: unknown, _t: string, code: string) => ({ id: `head-${code}`, code }));
});

describe("V4-G-09 refund approved -> GL reversal", () => {
  it("posts a balanced reversal: Dr revenue head, Cr bank, idempotent on the refund id", async () => {
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);
    const refundId = randomUUID();
    await q.publish(TOPIC, msg({
      id: refundId, paymentId: randomUUID(), applicationId: randomUUID(), receiptNo: "RCT-2026-00000001",
      amountMinor: "10000", currency: "INR", hoaCode: "4201", fullyRefunded: false,
    }));
    expect(m.spine).toHaveBeenCalledOnce();
    const j = m.spine.mock.calls[0]![1] as { sourceKey: string; type: string; lines: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint }> };
    expect(j.sourceKey).toBe(`citizen_refund:${refundId}`);
    expect(allowedJournalTypes().has(j.type)).toBe(true);
    const dr = j.lines.find((l) => l.debitMinor > 0n)!;
    const cr = j.lines.find((l) => l.creditMinor > 0n)!;
    expect(dr).toMatchObject({ accountCode: "head-4201", debitMinor: 10000n });
    expect(cr).toMatchObject({ accountCode: "head-1100", creditMinor: 10000n });
  });

  it("dead-letters with an alert (not a silent ack) when a head is missing", async () => {
    m.findHeadByCodeTx.mockResolvedValue(null);
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);
    await expect(q.publish(TOPIC, msg({ id: randomUUID(), paymentId: randomUUID(), amountMinor: "100", hoaCode: "4201" })))
      .rejects.toBeInstanceOf(NonRetryableError);
    expect(m.captureError).toHaveBeenCalledTimes(1);
    expect(m.spine).not.toHaveBeenCalled();
  });

  it("ignores a non-positive amount", async () => {
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);
    await q.publish(TOPIC, msg({ id: randomUUID(), paymentId: randomUUID(), amountMinor: "0" }));
    expect(m.spine).not.toHaveBeenCalled();
  });
});
