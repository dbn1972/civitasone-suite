/**
 * Central consumer of `search.index.update` for CROSS-MODULE search (finance, hrms, procurement, ...).
 *
 * Only events that carry a catalogue `entityType` are handled here; legacy events (no entityType) are ignored, so
 * existing publishers keep behaving exactly as before. A tenant that is not switched on (GLOBAL_SEARCH_TENANTS) is
 * skipped, which also covers in-flight events when a tenant is switched off.
 *
 * Tenant safety: the tenant used for the index write is the ENVELOPE tenant (set by the outbox from the producing
 * transaction); a payload that names another tenant is dropped, and the document id embeds the tenant, so an event
 * can neither write into nor delete from another tenant's slice.
 *
 * Failure policy: a malformed event (contract error) is dropped and logged, never retried (it can never succeed);
 * an engine error is rethrown so the queue retries. Upserts and deletes are idempotent.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import {
  GLOBAL_ENTITY_TYPES, GlobalSearchContractError, GlobalSearchIndex, SEARCH_INDEX_TOPIC, buildGlobalDocument,
  isGlobalEntityType, isGlobalSearchEnabled, type GlobalEntityType,
} from "@civitasone/search";

const log = pino({ name: "knowledge.global-search" });

export type GlobalIndexPort = Pick<GlobalSearchIndex, "initialize" | "upsert" | "remove">;

interface IndexEventPayload {
  id?: unknown;
  tenantId?: unknown;
  module?: unknown;
  name?: unknown;
  refNumber?: unknown;
  description?: unknown;
  status?: unknown;
  action?: unknown;
  entityType?: unknown;
}

export interface IndexEventMessage {
  messageId?: string;
  tenantId: string;
  payload: unknown;
}

let shared: { index: GlobalIndexPort; ready: Promise<void> | null } | null = null;

function sharedIndex(): { index: GlobalIndexPort; ready: () => Promise<void> } {
  if (!shared) shared = { index: new GlobalSearchIndex(), ready: null };
  const s = shared;
  return {
    index: s.index,
    ready: () => {
      if (!s.ready) s.ready = s.index.initialize().then(() => undefined).catch((e) => { s.ready = null; throw e; });
      return s.ready;
    },
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Returns what was done, for tests and logs. */
export async function handleGlobalSearchEvent(
  msg: IndexEventMessage,
  index: GlobalIndexPort = sharedIndex().index,
  ready: () => Promise<void> = sharedIndex().ready,
): Promise<"ignored-legacy" | "ignored-flag-off" | "dropped-invalid" | "upserted" | "removed"> {
  const p = (msg.payload ?? {}) as IndexEventPayload;
  if (!isGlobalEntityType(p.entityType)) return "ignored-legacy";
  const entityType: GlobalEntityType = p.entityType;
  if (!isGlobalSearchEnabled(msg.tenantId)) return "ignored-flag-off";
  if (str(p.tenantId)?.toLowerCase() !== msg.tenantId.toLowerCase() || p.module !== GLOBAL_ENTITY_TYPES[entityType].module) {
    log.warn({ messageId: msg.messageId, entityType }, "global search event: payload tenant/module disagrees with envelope; dropped");
    return "dropped-invalid";
  }
  const entityId = str(p.id) ?? "";
  try {
    if (p.action === "delete") {
      await ready();
      await index.remove(msg.tenantId, entityType, entityId);
      return "removed";
    }
    if (p.action !== "upsert") return "dropped-invalid";
    const { doc, redactions } = buildGlobalDocument({
      entityType, entityId, tenantId: msg.tenantId, title: str(p.name) ?? "", refNumber: str(p.refNumber),
      status: str(p.status) ?? "unknown", summary: str(p.description),
    });
    if (redactions > 0) log.warn({ messageId: msg.messageId, entityType, redactions }, "global search: personal-data-like content redacted at index time");
    await ready();
    await index.upsert([doc]);
    return "upserted";
  } catch (err) {
    if (err instanceof GlobalSearchContractError) {
      log.warn({ messageId: msg.messageId, entityType, err: err.message }, "global search event: invalid; dropped");
      return "dropped-invalid";
    }
    throw err; // engine/network error: let the queue retry
  }
}

export function registerGlobalSearchConsumer(queue: Queue): void {
  queue.subscribe(SEARCH_INDEX_TOPIC, async (msg) => {
    await handleGlobalSearchEvent({ messageId: msg.messageId, tenantId: msg.tenantId, payload: msg.payload });
  });
}
