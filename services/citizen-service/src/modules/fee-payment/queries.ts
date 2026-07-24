import * as repo from "./repo.js";

export async function listSchedules(tenantId: string) {
  return repo.listSchedules(tenantId);
}

export async function getPayment(tenantId: string, id: string) {
  return repo.findPaymentById(id, tenantId);
}

export async function listPaymentsByApplication(tenantId: string, applicationId: string) {
  return repo.listPaymentsByApplication(tenantId, applicationId);
}

export async function listRefunds(tenantId: string, paymentId: string) {
  return repo.listRefundsByPayment(tenantId, paymentId);
}
