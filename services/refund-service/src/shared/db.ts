import { sql } from "drizzle-orm";
import { createTenantDb } from "@civitasone/db";
import { schema as requestsModule } from "../modules/requests/schema.js";
import { schema as processingModule } from "../modules/processing/schema.js";
import { schema as reconciliationModule } from "../modules/reconciliation/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...requestsModule,
  ...processingModule,
  ...reconciliationModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { ScopedTx };

export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/**
 * RACE-2: acquires a Postgres session-level advisory lock scoped to the
 * transaction (pg_advisory_xact_lock -- released automatically on commit OR
 * rollback, no explicit unlock call exists or is needed). Used to serialize
 * actions on the same logical row across DIFFERENT queue topics/consumers,
 * which otherwise run as independent, unsynchronized poll loops with no
 * ordering between them (see services/queue-service/src/bus.ts's
 * SqsQueue.start -- one pollTopic() per topic). hashtext() folds an
 * arbitrary string key (e.g. a request id) into the bigint
 * pg_advisory_xact_lock expects.
 */
export async function lockForStatusChange(tx: ScopedTx, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * RACE-3: thrown by a consumer transaction callback to signal "a
 * compare-and-swap guard detected a lost race AFTER this transaction already
 * wrote something earlier in the same callback" (e.g. insertApproval already
 * ran before a later updateStatus guard failed). A plain `return false` in
 * that situation does NOT roll back the earlier write -- Drizzle/postgres-js
 * commits a transaction whenever the callback's promise RESOLVES, regardless
 * of the resolved value, and only rolls back when it REJECTS. Concretely:
 * without this, racing processing/consumer.ts's returnRequest against
 * requests/consumer.ts's withdrawRequest could have withdraw legitimately
 * win (final status "withdrawn"), while return's insertApproval and
 * supersedeApprovals had ALREADY committed before its own status guard
 * caught the conflict -- permanently recording a phantom "returned" decision
 * and incorrectly superseding a real, valid level-1 approval for a request
 * that was never actually returned. No money moved in that specific trace,
 * but the maker-checker audit trail -- the compliance record -- ended up
 * internally contradictory. Throwing this and catching it immediately
 * outside db.transaction(...) (see transactionOrRaceLost) gives the correct
 * all-or-nothing semantics while still letting the caller treat "lost the
 * race" as an expected, loggable no-op rather than a real processing error
 * the queue should retry.
 */
export class RaceLost extends Error {}

/**
 * Runs `fn` in a transaction; if it throws RaceLost, treats that as a normal
 * "lost the race" outcome (resolves to `false`) instead of letting it
 * propagate as a processing failure the queue would retry indefinitely. Any
 * OTHER error still propagates normally. Callers that have no earlier write
 * to protect (nothing committed yet at the point a guard can fail) can keep
 * using a plain `return false` -- that's still correct and simpler; this
 * wrapper is only needed once a domain write happens before a later guard
 * check in the same transaction.
 */
export async function transactionOrRaceLost<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T | false> {
  try {
    return await db.transaction(fn);
  } catch (err) {
    if (err instanceof RaceLost) return false;
    throw err;
  }
}
