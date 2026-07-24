import * as repo from "./repo.js";

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
