import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";
import * as disbursementRepo from "../disbursement/repo.js";
import * as ucRepo from "../utilisation/repo.js";
import type { ApplicationRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value as string).toISOString().slice(0, 10);
}

function mapGrantStatus(status: string): "active" | "completed" | "suspended" | "cancelled" {
  if (status === "approved" || status === "disbursing") return "active";
  if (status === "completed") return "completed";
  if (status === "suspended") return "suspended";
  if (status === "rejected" || status === "cancelled") return "cancelled";
  return "active";
}

/** Installment DB status → web read-model status. */
function mapInstallmentStatus(status: string): "pending" | "released" | "utilized" {
  if (status === "disbursed" || status === "released") return "released";
  if (status === "utilized") return "utilized";
  return "pending";
}

/**
 * Read-model projection of one application. disbursedAmount reflects only
 * COMPLETED (post-EFT settlement) disbursements — consistent with the write-side
 * ceiling in disbursement.repo.sumDisbursedForApplication — so pendingAmount is
 * the true outstanding balance, never a hardcoded full total.
 */
async function mapApplicationRow(row: ApplicationRow) {
  const [beneficiary, disbursedMinor] = await Promise.all([
    beneficiaryRepo.findBeneficiaryById(row.beneficiaryId, row.tenantId),
    disbursementRepo.sumDisbursedForApplication(db, row.id, row.tenantId),
  ]);
  const totalMinor = row.amountApprovedMinor || row.amountRequestedMinor;
  const pendingMinor = totalMinor - disbursedMinor > 0n ? totalMinor - disbursedMinor : 0n;
  return {
    id: row.id,
    grantNo: row.grantNo,
    title: row.purpose,
    granteeId: row.beneficiaryId,
    granteeName: beneficiary?.name,
    totalAmount: minorToAmount(totalMinor),
    disbursedAmount: minorToAmount(disbursedMinor),
    pendingAmount: minorToAmount(pendingMinor),
    sanctionDate: toDateOnly(row.approvedAt ?? row.submittedAt ?? row.createdAt),
    purpose: row.purpose,
    status: mapGrantStatus(row.status),
  };
}

export async function getApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "application", id),
    () => repo.findApplicationById(id, tenantId)
  );
}

export async function listGrantSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grants", `list:${limit}`),
    () => repo.listApplicationsByTenant(tenantId, limit),
  );
  return Promise.all((rows ?? []).map(mapApplicationRow));
}

export async function getGrantDetail(id: string, tenantId: string) {
  const row = await getApplication(tenantId, id);
  if (!row || row.tenantId !== tenantId) return null;

  // Populate the nested installments + UCs (previously hardcoded empty) so the
  // grant-detail view reflects the real disbursement & utilisation history.
  const [installmentRows, ucRows] = await Promise.all([
    disbursementRepo.findInstallmentsByApplication(id, tenantId),
    ucRepo.listUcByApplication(id, tenantId),
  ]);

  const installments = installmentRows
    .slice()
    .sort((a, b) => a.installmentNo - b.installmentNo)
    .map((inst) => {
      const out: {
        id: string; installmentNo: number; amount: number;
        scheduledDate: string; status: "pending" | "released" | "utilized";
        releasedDate?: string;
      } = {
        id: inst.id,
        installmentNo: inst.installmentNo,
        amount: minorToAmount(inst.amountMinor),
        scheduledDate: toDateOnly(inst.dueDate ?? inst.createdAt),
        status: mapInstallmentStatus(inst.status),
      };
      if (inst.status === "disbursed") out.releasedDate = toDateOnly(inst.updatedAt);
      return out;
    });

  const ucs = ucRows.map((uc) => ({
    id: uc.id,
    ucNo: uc.ucRef ?? uc.id,
    amount: minorToAmount(uc.utilisedMinor),
    period: uc.period,
    status: uc.validationStatus,
  }));

  return { ...(await mapApplicationRow(row)), installments, ucs };
}
