import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";
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

async function mapApplicationRow(row: ApplicationRow) {
  const beneficiary = await beneficiaryRepo.findBeneficiaryById(row.beneficiaryId);
  return {
    id: row.id,
    grantNo: row.grantNo,
    title: row.purpose,
    granteeId: row.beneficiaryId,
    granteeName: beneficiary?.name,
    totalAmount: minorToAmount(row.amountApprovedMinor || row.amountRequestedMinor),
    disbursedAmount: 0,
    pendingAmount: minorToAmount(row.amountApprovedMinor || row.amountRequestedMinor),
    sanctionDate: toDateOnly(row.approvedAt ?? row.submittedAt ?? row.createdAt),
    purpose: row.purpose,
    status: mapGrantStatus(row.status),
  };
}

export async function getApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "application", id),
    () => repo.findApplicationById(id)
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
  return { ...(await mapApplicationRow(row)), installments: [], ucs: [] };
}
