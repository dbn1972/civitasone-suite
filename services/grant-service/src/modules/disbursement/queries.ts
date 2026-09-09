import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value as string).toISOString().slice(0, 10);
}

export async function getInstallmentsByApplication(tenantId: string, appId: string) {
  return repo.findInstallmentsByApplication(appId, tenantId);
}

export async function listAllInstallments(tenantId: string, limit: number) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "installments", `list:${limit}`),
    () => repo.listInstallmentsByTenant(tenantId, limit),
  );
}

/**
 * PERF-005: was a 3N+1 — one findInstallmentById + one findApplicationById +
 * one findBeneficiaryById PER disbursement row. Now: the outer list (possibly
 * cache-served) plus exactly 3 batch queries total regardless of row count —
 * one inArray() fetch per hop of the installment -> application -> beneficiary
 * chain, joined in memory via Maps. Response shape and per-row field mapping
 * are unchanged from the original loop.
 */
export async function listGrantReleases(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grant_releases", `list:${limit}`),
    () => repo.listDisbursementsByTenant(tenantId, limit),
  );
  const list = rows ?? [];

  const installmentIds = [...new Set(list.map((row) => row.installmentId))];
  const installments = await repo.findInstallmentsByIds(installmentIds, tenantId);
  const installmentById = new Map(installments.map((i) => [i.id, i]));

  const applicationIds = [...new Set(installments.map((i) => i.applicationId))];
  const applications = await applicationRepo.findApplicationsByIds(applicationIds, tenantId);
  const applicationById = new Map(applications.map((a) => [a.id, a]));

  const beneficiaryIds = [...new Set(applications.map((a) => a.beneficiaryId))];
  const beneficiaries = await beneficiaryRepo.findBeneficiariesByIds(beneficiaryIds, tenantId);
  const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b]));

  return list.map((row) => {
    const installment = installmentById.get(row.installmentId) ?? null;
    const application = installment ? applicationById.get(installment.applicationId) ?? null : null;
    const beneficiary = application ? beneficiaryById.get(application.beneficiaryId) ?? null : null;
    return {
      id: row.id,
      releaseNo: row.pfmsTxnId ?? row.id.slice(0, 8).toUpperCase(),
      grantId: installment?.applicationId ?? row.id,
      grantNo: application?.grantNo ?? "—",
      granteeName: beneficiary?.name ?? "—",
      amount: minorToAmount(row.amountMinor),
      releaseDate: toDateOnly(row.disbursedAt ?? row.createdAt),
      bankRef: row.pfmsTxnId ?? undefined,
      status: (row.status === "completed" ? "credited" : row.status === "failed" ? "pending" : "processed") as "pending" | "processed" | "credited",
    };
  });
}
