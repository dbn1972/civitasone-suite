/**
 * Cross-service E2E test harness (10-T2).
 *
 * The headline gap this closes: every per-service consumer test uses an
 * in-process MemoryQueue and publishes the *consumed* topic directly, so the
 * producer→consumer hop ACROSS services is never exercised. This harness wires
 * a real downstream service's consumers onto ONE shared MemoryQueue, publishes
 * the PRODUCER's event, and lets the REAL consumer react. We then assert on the
 * cross-service EVENT CHAIN — the next topic the downstream service emits is
 * captured by a real test subscriber on the same queue (real publish→consume,
 * no regex matching of topic strings).
 *
 * How the DB is stubbed (so it runs in CI with zero infra):
 *   - `mockDb` replaces a service's `shared/db.js` export. Its `transaction(cb)`
 *     simply runs the callback with an in-memory fake `tx` that RECORDS row
 *     inserts (`harness.inserts`) instead of touching Postgres.
 *   - `mockEnqueue` / `mockMarkProcessed` replace the service's transactional
 *     outbox/inbox. `enqueue` immediately re-publishes the event onto the shared
 *     queue — exactly what the real outbox relay does after the tx commits —
 *     which is what makes the cross-service hop real. `markProcessed` provides
 *     in-memory idempotency.
 *
 * vi.mock factories are module-scoped, so they delegate to whichever harness is
 * "active" for the current test (set via setCurrentHarness() in beforeEach).
 */
import { MemoryQueue } from "../../packages/queue/dist/index.js";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";

export type CapturedInsert = { table: string; row: Record<string, unknown> };

type OutboxEvent = {
  topic: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
};

/** Best-effort drizzle table name (purely for nicer assertions/debugging). */
function tableName(table: unknown): string {
  if (table && typeof table === "object") {
    for (const sym of Object.getOwnPropertySymbols(table)) {
      if (sym.description?.includes("Name")) {
        const v = (table as Record<symbol, unknown>)[sym];
        if (typeof v === "string") return v;
      }
    }
    const named = table as { _?: { name?: string }; name?: string };
    if (named._?.name) return named._.name;
    if (named.name) return named.name;
  }
  return "unknown";
}

export class ChainHarness {
  /** The single shared bus every wired service consumer + test subscriber use. */
  readonly queue: MemoryQueue;
  /** Rows a consumer "would write" (captured instead of hitting Postgres). */
  readonly inserts: CapturedInsert[] = [];
  private readonly processedIds = new Set<string>();

  constructor() {
    this.queue = new MemoryQueue();
  }

  // In-memory fake transaction. Records inserts; updates/selects are inert.
  private readonly tx = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        this.inserts.push({ table: tableName(table), row });
      },
    }),
    update: (_table: unknown) => ({ set: () => ({ where: async () => {} }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] as unknown[] }) }) }),
  };

  // Fake `db` handed to a service's shared/db.js. transaction(cb) => cb(tx).
  readonly db = {
    transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(this.tx),
    insert: (t: unknown) => this.tx.insert(t),
    update: (t: unknown) => this.tx.update(t),
    select: () => this.tx.select(),
  };

  // Simulated outbox relay: publish the enqueued event onto the shared queue
  // immediately (as the real relay does post-commit). THIS is the cross-service
  // hop the old per-service tests never exercised.
  enqueue = async (_tx: unknown, e: OutboxEvent): Promise<void> => {
    await this.queue.publish(e.topic, {
      type: e.eventType,
      tenantId: e.tenantId,
      actorId: e.actorId,
      correlationId: e.correlationId,
      schemaVersion: "1.0",
      payload: e.payload,
    });
  };

  // Inbox idempotency (in-memory): returns false the second time a messageId is seen.
  markProcessed = async (_tx: unknown, messageId: string): Promise<boolean> => {
    if (this.processedIds.has(messageId)) return false;
    this.processedIds.add(messageId);
    return true;
  };

  /**
   * Register a real test subscriber on the shared queue and resolve with the
   * first envelope delivered to `topic`. Real publish→consume — no string
   * matching. Rejects if nothing arrives within `timeoutMs`.
   */
  nextEvent(topic: string, timeoutMs = 2000): Promise<CommandEnvelope> {
    return new Promise<CommandEnvelope>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms waiting for "${topic}"`)),
        timeoutMs,
      );
      this.queue.subscribe(topic, async (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }
}

// --- vi.mock delegation -----------------------------------------------------
// A single "active" harness the module-scoped mock factories forward to.
let active: ChainHarness | null = null;

export function setCurrentHarness(h: ChainHarness | null): void {
  active = h;
}

function current(): ChainHarness {
  if (!active) throw new Error("ChainHarness not active — call setCurrentHarness(h) in beforeEach");
  return active;
}

/** Stable object used to replace a service's `shared/db.js` `db` export. */
export const mockDb = {
  transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => current().db.transaction(cb),
  insert: (t: unknown) => current().db.insert(t),
  update: (t: unknown) => current().db.update(t),
  select: () => current().db.select(),
};

/** Stable fns used to replace a service's `shared/outbox.js` outbox helpers. */
export const mockEnqueue = (tx: unknown, e: OutboxEvent): Promise<void> => current().enqueue(tx, e);
export const mockMarkProcessed = (tx: unknown, id: string): Promise<boolean> =>
  current().markProcessed(tx, id);
