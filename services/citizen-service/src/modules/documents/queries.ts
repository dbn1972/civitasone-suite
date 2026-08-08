import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as portalRepo from "../portal/repo.js";
import * as applicationRepo from "../application/repo.js";
import { computeLaneChecklist } from "./domain.js";
import type { RequiredDocWithLane } from "../catalogue/lane-bindings.js";
import { HttpError } from "../../shared/context.js";

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
 *
 * FN-26 — optional `laneKey` scopes the checklist to documents bound to that
 * verification lane (officer workbasket at Inspect / Decision / …).
 */
export async function checklist(
  tenantId: string,
  serviceId?: string,
  applicationId?: string,
  laneKey?: string,
): Promise<{
  source: string; items: unknown[]; complete: boolean; laneKey: string | null;
}> {
  return db.transaction(async (tx) => {
    let resolvedServiceId = serviceId;
    // FN-26 — officer workbasket often only has application refId from the task.
    if (!resolvedServiceId && applicationId) {
      const app = await applicationRepo.findApplicationByIdTx(tx, applicationId, tenantId);
      if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
      resolvedServiceId = app.serviceId;
    }
    if (!resolvedServiceId) throw new HttpError(400, "VALIDATION_FAILED", "serviceId or applicationId required");

    const def = await catalogueRepo.findPublishedByServiceIdTx(tx, tenantId, resolvedServiceId);
    let required: RequiredDocWithLane[];
    let source: string;
    if (def) {
      required = def.requiredDocuments.map((d) => ({
        docType: d.docType,
        label: d.label,
        mandatory: d.mandatory,
        verifiedAtLane: d.verifiedAtLane,
      }));
      source = "catalogue";
    } else {
      const svc = await portalRepo.findServiceByIdTx(tx, resolvedServiceId, tenantId);
      required = (svc?.requiredDocs ?? []).map((docType) => ({ docType, mandatory: true }));
      source = "portal_service";
    }
    const subs = applicationId ? await repo.listByApplicationTx(tx, tenantId, applicationId) : [];
    const { items, complete, laneKey: normalizedLane } = computeLaneChecklist(required, subs, laneKey);
    return { source, items, complete, laneKey: normalizedLane };
  });
}
