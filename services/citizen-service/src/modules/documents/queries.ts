import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as portalRepo from "../portal/repo.js";
import { computeChecklist } from "./domain.js";

export async function getSubmission(tenantId: string, id: string) {
  return repo.findSubmissionById(id, tenantId);
}

export async function listByApplication(tenantId: string, applicationId: string) {
  return repo.listByApplication(tenantId, applicationId);
}

export async function listByApplicationForCitizen(tenantId: string, applicationId: string, citizenId: string) {
  return repo.listByApplicationForCitizen(tenantId, applicationId, citizenId);
}

export async function listPendingVerification(tenantId: string) {
  return repo.listPendingVerification(tenantId);
}

/**
 * Required-document checklist for a service, folding in the citizen's actual
 * submissions. The required list comes from the published SVC-081 catalogue
 * definition (by serviceId); if none is published it falls back to the portal
 * service's requiredDocs.
 */
export async function checklist(tenantId: string, serviceId: string, applicationId?: string): Promise<{
  source: string; items: unknown[]; complete: boolean;
}> {
  return db.transaction(async (tx) => {
    const def = await catalogueRepo.findPublishedByServiceIdTx(tx, tenantId, serviceId);
    let required: Array<{ docType: string; label?: string | undefined; mandatory: boolean }>;
    let source: string;
    if (def) {
      required = def.requiredDocuments.map((d) => ({ docType: d.docType, label: d.label, mandatory: d.mandatory }));
      source = "catalogue";
    } else {
      const svc = await portalRepo.findServiceByIdTx(tx, serviceId, tenantId);
      required = (svc?.requiredDocs ?? []).map((docType) => ({ docType, mandatory: true }));
      source = "portal_service";
    }
    const subs = applicationId ? await repo.listByApplicationTx(tx, tenantId, applicationId) : [];
    const { items, complete } = computeChecklist(required, subs);
    return { source, items, complete };
  });
}
