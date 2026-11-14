/**
 * "Re-read and publish" helper for write paths. A module calls `syncGlobalRecord` right after any insert / update /
 * status change of an indexed entity, inside the SAME transaction. It re-reads the row (so partial updates that only
 * return a count still index the true current state), publishes an upsert, or a delete when the row is gone or no
 * longer searchable. One call per write site keeps freshness a one-liner and independent of which columns changed.
 *
 *  - Flag off for the tenant: returns before any query or outbox write (no behaviour change for current tenants).
 *  - Tenant unknown at the call site (a helper that only has the row id): costs nothing unless SOME tenant is on.
 *  - Contract errors (e.g. empty title) are logged and skipped: search must never abort a business transaction.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { DrizzleTx } from "../indexing-types.js";
import type { GlobalEntityType } from "./catalogue.js";
import { GlobalSearchContractError, type GlobalSearchRecordInput } from "./contract.js";
import { enabledGlobalSearchTenants, isGlobalSearchEnabled } from "./flag.js";
import { publishGlobalSearchRecord, publishGlobalSearchRemoval } from "./publish.js";

const log = pino({ name: "search.global.sync" });

const NIL_ACTOR = "00000000-0000-0000-0000-000000000000";

export type SearchableFields = Omit<GlobalSearchRecordInput, "entityType" | "entityId" | "tenantId">;

export interface SyncArgs<Row extends { tenantId: string; updatedBy?: string | null }> {
  tx: DrizzleTx;
  entityType: GlobalEntityType;
  entityId: string;
  /** Pass when known: the flag check then runs before the row is read. */
  tenantId?: string | undefined;
  actorId?: string | undefined;
  load: () => Promise<Row | null | undefined>;
  /** Map the row to the contract fields; return null when the row must not be searchable (it is then removed). */
  toRecord: (row: Row) => SearchableFields | null;
}

export async function syncGlobalRecord<Row extends { tenantId: string; updatedBy?: string | null }>(a: SyncArgs<Row>): Promise<void> {
  if (a.tenantId !== undefined) {
    if (!isGlobalSearchEnabled(a.tenantId)) return;
  } else if (enabledGlobalSearchTenants().size === 0) {
    return;
  }
  const row = (await a.load()) ?? null;
  const tenantId = row?.tenantId ?? a.tenantId;
  if (!tenantId || !isGlobalSearchEnabled(tenantId)) return;
  const ctx = { actorId: a.actorId ?? row?.updatedBy ?? NIL_ACTOR, correlationId: randomUUID() };
  const fields = row ? a.toRecord(row) : null;
  try {
    if (!fields) {
      await publishGlobalSearchRemoval(a.tx, { entityType: a.entityType, entityId: a.entityId, tenantId }, ctx);
    } else {
      await publishGlobalSearchRecord(a.tx, { ...fields, entityType: a.entityType, entityId: a.entityId, tenantId }, ctx);
    }
  } catch (err) {
    if (err instanceof GlobalSearchContractError) {
      log.warn({ entityType: a.entityType, err: err.message }, "global search: record skipped (contract)");
      return;
    }
    throw err;
  }
}
