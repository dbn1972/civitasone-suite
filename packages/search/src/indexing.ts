/**
 * @civitasone/search — Cross-service search indexing utility.
 *
 * Provides `publishSearchIndex` to enqueue search-index-update events via the
 * transactional outbox. Each service calls this within its consumer transaction
 * on entity create/update/delete to keep the centralized search index in sync.
 *
 * The event is published to the `search.index.update` topic and consumed by a
 * centralized search consumer that writes to Meilisearch/OpenSearch.
 *
 * Usage:
 *   import { publishSearchIndex } from "@civitasone/search";
 *
 *   await db.transaction(async (tx) => {
 *     // ... business write ...
 *     await publishSearchIndex(tx, {
 *       id: entity.id,
 *       tenantId: msg.tenantId,
 *       module: "hrms",
 *       name: entity.name,
 *       refNumber: entity.employeeNo,
 *       description: entity.designation,
 *       status: entity.status,
 *       action: "upsert",
 *       actorId: msg.actorId,
 *       correlationId: msg.correlationId,
 *     });
 *   });
 */

import type { DrizzleTx } from "./indexing-types.js";

/** The topic used for all search index update events. */
export const SEARCH_INDEX_TOPIC = "search.index.update";

/** The event type for search index updates. */
export const SEARCH_INDEX_EVENT_TYPE = "search.index.updated";

/** A document to be indexed across the global search. */
export interface SearchIndexDocument {
  /** Entity UUID. */
  id: string;
  /** Tenant isolation key. */
  tenantId: string;
  /** Source module identifier (e.g. "hrms", "finance", "procurement"). */
  module: string;
  /** Primary display name of the entity. */
  name: string;
  /** Optional reference number (employee no, bill no, PO no, etc.). */
  refNumber?: string | undefined;
  /** Optional description or summary. */
  description?: string | undefined;
  /** Current status of the entity. */
  status: string;
}

/** Input for publishing a search index event via the outbox. */
export interface PublishSearchIndexInput extends SearchIndexDocument {
  /** Action to perform on the search index. */
  action: "upsert" | "delete";
  /** Actor performing the mutation. */
  actorId: string;
  /** Correlation ID for tracing. */
  correlationId: string;
}

/**
 * Publish a search-index-update event to the outbox. MUST be called inside the
 * same transaction as the business write to guarantee eventual delivery.
 *
 * On `action: "upsert"`, the centralized consumer will index/update the document.
 * On `action: "delete"`, the consumer will remove the document from the index.
 */
export async function publishSearchIndex(
  tx: DrizzleTx,
  input: PublishSearchIndexInput
): Promise<void> {
  const { enqueue } = await import("@civitasone/outbox");

  await enqueue(tx, {
    topic: SEARCH_INDEX_TOPIC,
    eventType: SEARCH_INDEX_EVENT_TYPE,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    payload: {
      id: input.id,
      tenantId: input.tenantId,
      module: input.module,
      name: input.name,
      refNumber: input.refNumber ?? null,
      description: input.description ?? null,
      status: input.status,
      action: input.action,
    },
  });
}
