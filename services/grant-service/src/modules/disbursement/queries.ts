import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";
import * as schemeRepo from "../scheme/repo.js";
import { mapInstallmentStatus } from "../application/queries.js";
import { effectiveGrantStatus } from "./domain.js";
import type { InstallmentRow } from "./schema.js";

function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value as string).toISOString().slice(0, 10);
}

/**
 * GAP-GRANTS-INSTALLMENTS-03: the installments read-model (GrantInstallmentSummary on the web).
 * Projects raw installment rows to the wire shape - grant number, grantee, paise amount, and the
 * two facts the release control needs: `grantStatus` (application + scheme state, see
 * effectiveGrantStatus) and the payee's MASKED account (last 4 digits + IFSC; the full number is
 * never stored here). Three batch queries regardless of row count (application, scheme,
 * beneficiary) plus one for bank accounts - no N+1.
 */
export async function projectInstallmentSummaries(tenantId: string, rows: InstallmentRow[]) {
  const applicationIds = [...new Set(rows.map((r) => r.applicationId))];
  const applications = await applicationRepo.findApplicationsByIds(applicationIds, tenantId);
  const applicationById = new Map(applications.map((a) => [a.id, a]));

  const [schemes, beneficiaries] = await Promise.all([
    schemeRepo.findSchemesByIds([...new Set(applications.map((a) => a.schemeId))], tenantId),
    beneficiaryRepo.findBeneficiariesByIds([...new Set(applications.map((a) => a.beneficiaryId))], tenantId),
  ]);
  const schemeById = new Map(schemes.map((s) => [s.id, s]));
  const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b]));
  const bankByBeneficiary = await beneficiaryRepo.findLatestActiveBankAccounts([...beneficiaryById.keys()], tenantId);

  return rows
    .map((row) => {
      const application = applicationById.get(row.applicationId) ?? null;
      const scheme = application ? schemeById.get(application.schemeId) ?? null : null;
      const beneficiary = application ? beneficiaryById.get(application.beneficiaryId) ?? null : null;
      const bank = beneficiary ? bankByBeneficiary.get(beneficiary.id) ?? null : null;
      const status = mapInstallmentStatus(row.status);
      return {
        id: row.id,
        grantId: row.applicationId,
        grantNo: application?.grantNo ?? row.applicationId,
        granteeName: beneficiary?.name ?? null,
        installmentNo: row.installmentNo,
        // Minor units (paise) on the wire, like /releases: the web formats with formatMoney(minor).
        amount: Number(row.amountMinor),
        scheduledDate: toDateOnly(row.dueDate ?? row.createdAt),
        ...(row.status === "disbursed" ? { releasedDate: toDateOnly(row.updatedAt) } : {}),
        status,
        grantStatus: application ? effectiveGrantStatus(application.status, scheme?.status) : ("active" as const),
        payeeAccountLast4: bank ? bank.accountNoMasked.slice(-4) : null,
        payeeIfsc: bank ? bank.bankIfsc : null,
      };
    })
    .sort((a, b) => a.grantNo.localeCompare(b.grantNo) || a.installmentNo - b.installmentNo);
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
      granteeName: beneficiary?.name ?? null,
      // GAP-GRANTS-DISBURSEMENTS-DETAIL-02 (money unit): amount is MINOR units
      // (paise) on the wire, consistent with CLAUDE.md rule 11 (money is bigint
      // paise end to end). grant_disbursements.amount_minor is bigint paise;
      // we pass it through as a JSON-safe integer. Both consumers — the releases
      // list (formatMoney) and the disbursement detail (formatMoney + amountMinor
      // forwarded straight to the eOffice note) — treat it as paise, so the two
      // screens stay reconciled with no float *100 / /100 conversion anywhere.
      amount: Number(row.amountMinor),
      releaseDate: toDateOnly(row.disbursedAt ?? row.createdAt),
      bankRef: row.pfmsTxnId ?? undefined,
      status: (row.status === "completed" ? "credited" : row.status === "failed" ? "pending" : "processed") as "pending" | "processed" | "credited",
    };
  });
}
