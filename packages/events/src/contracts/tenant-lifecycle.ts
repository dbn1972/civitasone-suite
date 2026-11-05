/**
 * UAT bundle 15 (F133): the tenant.tenant.created hand-off, tenant-service -> admin-service.
 *
 * tenant-service emitted `{ tenantId, plan }` while admin-service read `{ id, name, domain, edition, region,
 * residency }` from the same event, so the admin consumer inserted a row with no id and every new tenant was missing
 * from /admin/tenants (/admin/tenants/[id] 404 while the tenant existed in tenant-service).
 *
 * v1.1 (this file): the producer sends the directory fields the consumer registers. Every field added in v1.1 is
 * optional, so a v1.0 event (`{ tenantId, plan }`, still in queues and DLQs) still validates; the consumer fills the
 * gap from tenant-service (see services/admin-service/src/modules/tenants/tenant-created.ts). `plan` is the v1.0
 * name of `edition` and is kept as an alias.
 */
import { z } from "zod";
import { defineContract } from "./define.js";

const zUuid = z.string().uuid();

export const tenantTenantCreated = defineContract({
  topic: "tenant.tenant.created",
  kind: "event",
  owner: "tenant-service",
  version: "1.1",
  // admin-service registers the tenant from the directory fields; hrms, meeting, workflow and policy (POLICY-SEED-1:
  // standard approve grants) read only tenantId.
  consumers: ["admin-service", "hrms-service", "meeting-service", "policy-service", "workflow-service"],
  // Organisation directory data only (office name, domain, region): no personal data.
  pii: [],
  schema: z.object({
    tenantId: zUuid,
    /** v1.0 name of `edition`; still sent so a v1.0 reader keeps working. */
    plan: z.string().min(1).optional(),
    id: zUuid.optional(),
    name: z.string().min(1).max(200).optional(),
    domain: z.string().min(1).max(253).optional(),
    edition: z.string().min(1).max(32).optional(),
    status: z.string().min(1).max(24).optional(),
    region: z.string().min(1).max(64).optional(),
    residency: z.string().min(1).max(64).optional(),
  }),
});

/** The fields a consumer needs to register a tenant in its own directory. */
export const TENANT_DIRECTORY_FIELDS = ["name", "domain", "edition", "region", "residency"] as const;
export type TenantDirectoryField = (typeof TENANT_DIRECTORY_FIELDS)[number];

export type TenantCreatedEvent = {
  tenantId: string;
  plan?: string;
  id?: string;
  name?: string;
  domain?: string;
  edition?: string;
  status?: string;
  region?: string;
  residency?: string;
};

/** Directory fields a (possibly v1.0) tenant.tenant.created payload does not carry. `plan` stands in for `edition`. */
export function missingTenantDirectoryFields(p: TenantCreatedEvent): TenantDirectoryField[] {
  return TENANT_DIRECTORY_FIELDS.filter((f) => {
    const v = f === "edition" ? (p.edition ?? p.plan) : p[f];
    return typeof v !== "string" || v.trim().length === 0;
  });
}

export const tenantLifecycleContracts = [tenantTenantCreated] as const;
