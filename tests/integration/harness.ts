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
 * 10-T3 extension (backwards-compatible). Real downstream consumers do more than
 * a bare `tx.insert(t).values(row)`: they upsert (`.onConflictDoUpdate`/
 * `.onConflictDoNothing`), they read-before-write (`db.select(...)`), and some
 * read back the row they just wrote (`.returning()`). The original fake `tx`
 * could not model any of these — inserts were a bare Promise, updates were inert,
 * and every select resolved to `[]`. The extension below makes:
 *   - `tx.insert(t).values(row)` a THENABLE that ALSO exposes
 *     `.onConflictDoNothing()`, `.onConflictDoUpdate({...})`, and `.returning()`.
 *     The row is recorded exactly once (on `.values(...)`, as before), and
 *     `.returning()` resolves to the inserted row(s). Awaiting it still works.
 *   - `tx.update(t).set(...).where(...)` a THENABLE exposing `.returning()` so
 *     CAS-style "update … returning id" consumers (e.g. the workflow SLA sweeper)
 *     observe a non-empty result. By default a single synthetic `{}` row is
 *     returned; tests seed real returning rows via `seedUpdateReturning(rows)`.
 *   - `select()` SEEDABLE: `harness.seedSelect(tableHint, rows)` makes a
 *     read-before-write consumer get real rows back. Default is `[]` (unchanged).
 *     The chain supports BOTH `.from().where().limit()` AND `.from().where()`
 *     (no `.limit()` — e.g. asset `findDueEntries`).
 *
 * Every prior test still passes: the default (unseeded) behaviour is identical —
 * inserts record one row, selects resolve to `[]`, awaiting an insert resolves.
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

/**
 * A Promise-like that also carries chainable drizzle-ish builder methods. We
 * implement `then`/`catch`/`finally` by delegating to a resolved inner promise
 * so `await`ing the builder works exactly like the old bare-Promise behaviour,
 * while the extra methods let real consumers chain `.onConflict*()`/`.returning()`.
 */
function makeThenable<T>(value: () => T): Record<string, unknown> & PromiseLike<T> {
  const settle = () => Promise.resolve(value());
  const obj: Record<string, unknown> = {
    then: (onF?: ((v: T) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
      settle().then(onF as never, onR as never),
    catch: (onR?: ((e: unknown) => unknown) | null) => settle().catch(onR as never),
    finally: (onF?: (() => void) | null) => settle().finally(onF as never),
  };
  return obj as Record<string, unknown> & PromiseLike<T>;
}

export class ChainHarness {
  /** The single shared bus every wired service consumer + test subscriber use. */
  readonly queue: MemoryQueue;
  /** Rows a consumer "would write" (captured instead of hitting Postgres). */
  readonly inserts: CapturedInsert[] = [];
  private readonly processedIds = new Set<string>();

  /** Per-test canned SELECT results, keyed by a table-name substring hint. */
  private readonly selectSeeds: Array<{ hint: string; rows: unknown[] }> = [];
  /** Per-test canned `update(...).returning()` rows (default: one `{}` row). */
  private updateReturningRows: unknown[] | null = null;

  constructor() {
    this.queue = new MemoryQueue();
  }

  /**
   * Seed the rows a `select()` should resolve to. `tableHint` is matched as a
   * case-insensitive substring against the drizzle table name of the `.from(t)`.
   * The empty string matches any table (a catch-all). Last matching seed wins,
   * so a specific hint registered after a catch-all overrides it.
   */
  seedSelect(tableHint: string, rows: unknown[]): this {
    this.selectSeeds.push({ hint: tableHint.toLowerCase(), rows });
    return this;
  }

  /** Seed the rows an `update(...).set(...).where(...).returning()` resolves to. */
  seedUpdateReturning(rows: unknown[]): this {
    this.updateReturningRows = rows;
    return this;
  }

  private seededRowsFor(table: unknown): unknown[] {
    const name = tableName(table).toLowerCase();
    let chosen: unknown[] = [];
    for (const seed of this.selectSeeds) {
      if (seed.hint === "" || name.includes(seed.hint)) chosen = seed.rows;
    }
    return chosen;
  }

  // In-memory fake transaction.
  //  - insert records a row (once, on .values) and is a thenable that also
  //    exposes .onConflictDoNothing / .onConflictDoUpdate / .returning.
  //  - update is a thenable exposing .returning (seedable; default one {} row).
  //  - select resolves to seeded rows (default []), with or without .limit().
  private readonly tx = {
    insert: (table: unknown) => ({
      values: (rowOrRows: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        for (const row of rows) this.inserts.push({ table: tableName(table), row });
        const builder = makeThenable<Record<string, unknown>[]>(() => rows);
        builder.onConflictDoNothing = () => builder;
        builder.onConflictDoUpdate = (_args?: unknown) => builder;
        builder.returning = (_proj?: unknown) => makeThenable<Record<string, unknown>[]>(() => rows);
        return builder;
      },
    }),
    update: (_table: unknown) => ({
      set: (_values: unknown) => {
        const result = () => (this.updateReturningRows ?? [{}]) as unknown[];
        const where = (_cond?: unknown) => {
          const builder = makeThenable<unknown[]>(result);
          builder.returning = (_proj?: unknown) => makeThenable<unknown[]>(result);
          return builder;
        };
        return { where };
      },
    }),
    select: (_proj?: unknown) => {
      const self = this;
      const from = (table: unknown) => {
        const rows = () => self.seededRowsFor(table);
        const where = (_cond?: unknown) => {
          const limitable = makeThenable<unknown[]>(rows);
          limitable.limit = (_n?: unknown) => {
            const offsetable = makeThenable<unknown[]>(rows);
            offsetable.offset = (_o?: unknown) => makeThenable<unknown[]>(rows);
            return offsetable;
          };
          limitable.offset = (_o?: unknown) => makeThenable<unknown[]>(rows);
          return limitable;
        };
        return { where };
      };
      return { from };
    },
  };

  // Fake `db` handed to a service's shared/db.js. transaction(cb) => cb(tx).
  readonly db = {
    transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(this.tx),
    insert: (t: unknown) => this.tx.insert(t),
    update: (t: unknown) => this.tx.update(t),
    select: (proj?: unknown) => this.tx.select(proj),
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
  select: (proj?: unknown) => current().db.select(proj),
};

/** Stable fns used to replace a service's `shared/outbox.js` outbox helpers. */
export const mockEnqueue = (tx: unknown, e: OutboxEvent): Promise<void> => current().enqueue(tx, e);
export const mockMarkProcessed = (tx: unknown, id: string): Promise<boolean> =>
  current().markProcessed(tx, id);
