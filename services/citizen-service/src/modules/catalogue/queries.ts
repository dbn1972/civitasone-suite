import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ServiceChannel } from "./domain.js";

type Row = Awaited<ReturnType<typeof repo.findDefinitionById>>;

/**
 * Strip the webhook HMAC secret from a definition before it leaves the service.
 *
 * FN-30 stores the shared secret on the definition row, and every read path here
 * feeds an HTTP response — including the citizen-facing ones. A secret that a
 * receiving agency relies on to prove a callback is genuine must never be
 * readable over the catalogue API, so it is replaced with a presence flag: the
 * Designer still needs to show "configured" without ever holding the value.
 *
 * Repo stays unredacted on purpose — an internal dispatcher needs the real
 * secret to sign with. Redaction belongs on the read-for-response boundary.
 */
function redactSecrets<T extends Row>(row: T): T {
  if (!row) return row;
  const subs = row.webhookSubscriptions;
  if (!Array.isArray(subs) || subs.length === 0) return row;
  return {
    ...row,
    webhookSubscriptions: subs.map(({ secret, ...rest }) => ({
      ...rest,
      secretConfigured: typeof secret === "string" && secret.length > 0,
    })),
  } as T;
}

/**
 * Citizen-facing view: drop the blocks that exist purely for administration.
 *
 * A citizen has no use for webhook subscriptions, and office overrides carry a
 * `note` field that FN-22 defines as being for auditors rather than citizens —
 * publishing internal fee-policy reasoning on a public endpoint would contradict
 * that. The office's *effective* fee still reaches the citizen through the
 * resolved blocks; what is hidden is the configuration behind it.
 */
function forCitizen<T extends Row>(row: T): T {
  if (!row) return row;
  return { ...row, webhookSubscriptions: [], officeOverrides: [] } as T;
}

export async function listDefinitions(tenantId: string) {
  return (await repo.listDefinitions(tenantId)).map(redactSecrets);
}

export async function getDefinition(tenantId: string, id: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "catalogue", id), async () =>
    // Redacted BEFORE caching, so the cache never holds a secret either.
    redactSecrets(await repo.findDefinitionById(id, tenantId)),
  );
}

/** Citizen-facing browse: latest published definitions across the catalogue. */
export async function browsePublished(tenantId: string) {
  return (await repo.listPublished(tenantId)).map((r) => forCitizen(redactSecrets(r)));
}

/** Citizen-facing detail: latest published definition for a service_key. */
export async function getPublishedByKey(tenantId: string, serviceKey: string) {
  return forCitizen(redactSecrets(await repo.findPublishedByKey(tenantId, serviceKey)));
}

/** Latest published definition for a logical serviceId (opaque UUID). */
export async function getPublishedByServiceId(tenantId: string, serviceId: string) {
  return forCitizen(redactSecrets(await repo.findPublishedByServiceId(tenantId, serviceId)));
}

/**
 * FN-24 — resolve the published channel allow-list for intake.
 * Accepts definition row id, logical serviceId, or serviceKey.
 * Returns null when no published definition is found (caller decides fail-open/closed).
 */
export async function getPublishedChannels(
  tenantId: string,
  opts: { serviceId?: string | undefined; serviceKey?: string | undefined },
): Promise<ServiceChannel[] | null> {
  if (opts.serviceId) {
    const byDefId = await repo.findDefinitionById(opts.serviceId, tenantId);
    if (byDefId?.status === "published") return byDefId.channels;
    const byLogical = await repo.findPublishedByServiceId(tenantId, opts.serviceId);
    if (byLogical) return byLogical.channels;
  }
  if (opts.serviceKey) {
    const byKey = await repo.findPublishedByKey(tenantId, opts.serviceKey);
    if (byKey) return byKey.channels;
  }
  return null;
}
