import type { Queue } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import * as repo from "./repo.js";

/** Command topic other services publish to register a monitoring geo-point. */
export const GEO_POINT_REGISTER = "location.geo_point.register";

type Payload = { domain: string; refId: string; lat: number; lng: number; label?: string | null; status?: string | null };

/**
 * SVC-119: extension point — any service can publish `location.geo_point.register`
 * to place a point on the monitoring map. Idempotent upsert in a tenant-GUC tx.
 */
export function registerGeoPointConsumers(queue: Queue): void {
  queue.subscribe<Payload>(GEO_POINT_REGISTER, withTenantConsumer(async (msg) => {
    const p = msg.payload;
    await repo.upsertGeoPoint(msg.tenantId, msg.actorId, {
      domain: p.domain, refId: p.refId, lat: p.lat, lng: p.lng, label: p.label ?? null, status: p.status ?? "active",
    });
  }));
}
