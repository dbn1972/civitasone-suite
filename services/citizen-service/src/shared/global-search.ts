/**
 * Citizen applications -> cross-module search, for OFFICERS. Indexed: the application reference number, the service name
 * and the status. NOTHING about the applicant: citizen id, applicant type, tracking number, channel, assisting officer and
 * documents are never selected, so they cannot be indexed. Flag off for the tenant => returns before any query.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { citizenApplications } from "../modules/application/schema.js";
import { serviceDefinitions } from "../modules/catalogue/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;

const cols = {
  id: citizenApplications.id, tenantId: citizenApplications.tenantId, updatedBy: citizenApplications.updatedBy,
  refNo: citizenApplications.refNo, status: citizenApplications.status, serviceName: serviceDefinitions.name,
};
type Row = { refNo: string; status: string; serviceName: string | null };
export const applicationFields = (r: Row): SearchableFields => ({
  title: `Application ${r.refNo}`, refNumber: r.refNo, status: r.status, summary: r.serviceName ?? undefined,
});

const base = (tx: Reader) => tx.select(cols).from(citizenApplications).leftJoin(
  serviceDefinitions, and(eq(serviceDefinitions.id, citizenApplications.serviceId), eq(serviceDefinitions.tenantId, citizenApplications.tenantId)),
);

export async function syncApplication(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: tx as unknown as DrizzleTx, entityType: "citizen.application", entityId: id, tenantId,
    load: async () => (await base(tx)
      .where(tenantId ? and(eq(citizenApplications.id, id), eq(citizenApplications.tenantId, tenantId)) : eq(citizenApplications.id, id)).limit(1))[0],
    toRecord: applicationFields,
  });
}

export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [{
    entityType: "citizen.application",
    source: {
      tenantId, idOf: (r: { id: string }) => r.id,
      fetchPage: (after: string | null, size: number) => withTenant((tx) => base(tx)
        .where(and(eq(citizenApplications.tenantId, tenantId), after ? gt(citizenApplications.id, after) : undefined)).orderBy(asc(citizenApplications.id)).limit(size)),
      toRecord: (r: Row & { id: string }) => ({ ...applicationFields(r), entityType: "citizen.application" as const, entityId: r.id, tenantId }),
    },
  }];
}
