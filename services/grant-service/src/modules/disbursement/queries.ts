import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

export async function getInstallmentsByApplication(tenantId: string, appId: string) {
  return repo.findInstallmentsByApplication(appId);
}

export async function listAllInstallments(tenantId: string, limit: number) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "installments", `list:${limit}`),
    () => repo.listInstallmentsByTenant(tenantId, limit),
  );
}

export async function listGrantReleases(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grant_releases", `list:${limit}`),
    () => repo.listDisbursementsByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const installment = await repo.findInstallmentById(row.installmentId);
    const application = installment ? await applicationRepo.findApplicationById(installment.applicationId) : null;
    const beneficiary = application ? await beneficiaryRepo.findBeneficiaryById(application.beneficiaryId) : null;
    summaries.push({
      id: row.id,
      releaseNo: row.pfmsTxnId ?? row.id.slice(0, 8).toUpperCase(),
      grantId: installment?.applicationId ?? row.id,
      grantNo: application?.grantNo ?? "—",
      granteeName: beneficiary?.name ?? "—",
      amount: minorToAmount(row.amountMinor),
      releaseDate: (row.disbursedAt ?? row.createdAt).toISOString().slice(0, 10),
      bankRef: row.pfmsTxnId ?? undefined,
      status: (row.status === "completed" ? "credited" : row.status === "failed" ? "pending" : "processed") as "pending" | "processed" | "credited",
    });
  }
  return summaries;
}
