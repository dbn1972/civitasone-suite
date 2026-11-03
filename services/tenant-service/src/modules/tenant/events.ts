/**
 * Payload builders for the events tenant-service publishes.
 *
 * UAT bundle 15 (F133): tenant.tenant.created used to carry only `{ tenantId, plan }`, which is not enough for a
 * consumer to register the tenant (admin-service needs name, domain, edition, region and residency). The shape is the
 * shared contract `tenantTenantCreated` v1.1 in @civitasone/events/contracts.
 */
import type { TenantCreatedEvent } from "@civitasone/events/contracts";
import type { TenantView } from "./domain.js";

type TenantCreatedSource = Pick<TenantView, "id" | "name" | "domain" | "edition" | "region" | "residency"> & { status?: string };

/** tenant.tenant.created v1.1. Directory fields only: tenant settings and placement-policy details stay off the event. */
export function tenantCreatedEventPayload(t: TenantCreatedSource): TenantCreatedEvent {
  return {
    tenantId: t.id,
    id: t.id,
    // v1.0 name of `edition`, kept for any reader that still reads it.
    plan: t.edition,
    edition: t.edition,
    name: t.name,
    domain: t.domain,
    status: t.status ?? "draft",
    region: t.region,
    residency: t.residency,
  };
}
