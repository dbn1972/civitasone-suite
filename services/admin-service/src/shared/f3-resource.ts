/**
 * F3 async-create resource ids (FQ12 admin #3/#5/#6/#10/#16/#22/#23/#34/#41/#42/#43).
 *
 * An F3 create route answers 202 before the row exists, so it must decide the
 * new row's primary key itself and hand it to the consumer. Previously each
 * apply_* let the DB default (`defaultRandom()`) mint the id, so the 202's
 * `data.id` was only the command id and named no resource: GET /…/:id with it
 * was a 404 and the web (change/NewChangeButton) navigated to a dead page.
 *
 * Now the route mints `resourceId`, publishes it in the command payload, and
 * the apply inserts with exactly that id. The 202 keeps every field it already
 * had (`id`, `status`, `correlationId`, `data.id`) and adds `data.commandId`;
 * for a fresh create resourceId === commandId, so the top-level `id` that
 * existing callers read is now also a real resource id.
 */
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { db } from "./db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The pre-minted resource id carried by an F3 command payload, if well-formed. */
export function resourceIdOf(payload: Record<string, unknown> | undefined): string | undefined {
  const v = payload?.resourceId;
  return typeof v === "string" && UUID_RE.test(v) ? v : undefined;
}

/** `{ id }` spread for an insert: the pre-minted id, or nothing (DB default) for legacy messages. */
export function withResourceId(resourceId: string | undefined): { id?: string } {
  return resourceId ? { id: resourceId } : {};
}

/** 202 body for an F3 create: unchanged envelope + the resource id the write will create. */
export function acceptedCreate(
  ctx: { correlationId: string },
  commandId: string,
  resourceId: string,
): { id: string; status: "accepted"; correlationId: string; data: { id: string; commandId: string } } {
  return { id: commandId, status: "accepted", correlationId: ctx.correlationId, data: { id: resourceId, commandId } };
}

/**
 * True when a row with this id already exists. The F3 consumers claim
 * idempotency only AFTER apply succeeds, so a redelivery can re-run a create
 * whose transaction already committed; with a pre-minted id that replay is
 * detected here and becomes a no-op instead of a PK violation (or, before this
 * change, a silent duplicate row).
 */
export async function resourceExists(
  tx: Pick<typeof db, "select">,
  table: PgTable & { id: AnyPgColumn },
  id: string | undefined,
): Promise<boolean> {
  if (!id) return false;
  const rows = await tx.select({ one: sql<number>`1` }).from(table as PgTable).where(eq(table.id, id)).limit(1);
  return rows.length > 0;
}
