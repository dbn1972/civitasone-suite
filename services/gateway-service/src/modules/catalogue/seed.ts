/**
 * CAP-052 — seed the API catalogue from the live gateway route registry
 * (registry.ts SERVICE_ROUTES). Idempotent: re-running upserts descriptive
 * fields without disturbing lifecycle status. New rows get a 'registered'
 * changelog entry.
 */
import { SERVICE_ROUTES } from "../../registry.js";
import * as repo from "./repo.js";
import type { Tx } from "./repo.js";
import type { ApiEntryInsert } from "./schema.js";

/** Derive an API version label from a route prefix (`/api/v1/...` → `v1`). */
export function versionFromPrefix(prefix: string): string {
  const m = /\/api\/(v\d+)\//.exec(prefix + "/");
  return m?.[1] ?? "v1";
}

export function registryEntries(tenantId: string, actorId: string): ApiEntryInsert[] {
  return SERVICE_ROUTES.map((r) => ({
    tenantId,
    name: r.name,
    module: r.name.replace(/-(v\d+|alias)$/, "").split("-")[0] ?? r.name,
    version: versionFromPrefix(r.prefix),
    path: r.prefix,
    method: "ANY" as const,
    upstream: r.upstream,
    owner: "platform",
    status: "active" as const,
    source: "registry" as const,
    description: `Gateway route → ${r.upstreamPath ?? r.prefix.replace(/^\/api/, "")}`,
    createdBy: actorId,
  }));
}

export async function seedFromRegistry(
  tx: Tx,
  tenantId: string,
  actorId: string,
): Promise<{ total: number; created: number }> {
  const entries = registryEntries(tenantId, actorId);
  let created = 0;
  for (const e of entries) {
    const existing = await repo.findByKey(tx, tenantId, {
      name: e.name,
      version: e.version ?? "v1",
      method: e.method ?? "ANY",
      path: e.path,
    });
    const row = await repo.upsertEntry(tx, e);
    if (!existing) {
      created++;
      await repo.insertChangelog(tx, {
        tenantId,
        apiId: row.id,
        changeType: "registered",
        toStatus: row.status,
        note: "seeded from gateway route registry",
        actorId,
      });
    }
  }
  return { total: entries.length, created };
}
