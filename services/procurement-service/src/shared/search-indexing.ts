/**
 * Procurement search indexing — wires @civitasone/search indexing via the outbox.
 *
 * Call `indexEntity` within consumer transactions on create/update to upsert
 * the entity into the global search index, or `deindexEntity` on soft-delete
 * to remove it within 5s (via outbox relay).
 */
import { publishSearchIndex } from "@civitasone/search";
import type { DrizzleTx } from "@civitasone/search";

const MODULE = "procurement";

export interface SearchIndexInput {
  id: string;
  tenantId: string;
  name: string;
  refNumber?: string | undefined;
  description?: string | undefined;
  status: string;
  actorId: string;
  correlationId: string;
}

/** Index or update a procurement entity in the global search. */
export async function indexEntity(tx: DrizzleTx, input: SearchIndexInput): Promise<void> {
  await publishSearchIndex(tx, {
    ...input,
    module: MODULE,
    action: "upsert",
  });
}

/** Remove a procurement entity from the global search (on soft-delete). */
export async function deindexEntity(
  tx: DrizzleTx,
  input: Pick<SearchIndexInput, "id" | "tenantId" | "actorId" | "correlationId"> & { name?: string; status?: string }
): Promise<void> {
  await publishSearchIndex(tx, {
    id: input.id,
    tenantId: input.tenantId,
    module: MODULE,
    name: input.name ?? "",
    status: input.status ?? "deleted",
    action: "delete",
    actorId: input.actorId,
    correlationId: input.correlationId,
  });
}
