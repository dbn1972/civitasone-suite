import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function mapUcStatus(status: string): "pending" | "submitted" | "verified" | "rejected" {
  if (status === "verified") return "verified";
  if (status === "rejected") return "rejected";
  if (status === "submitted") return "submitted";
  return "pending";
}

/**
 * GAP-GRANTS-DETAIL-05: the APPROVED outcome of a UC lives in
 * `validation_status` ("validated"/"rejected"), set when an officer verifies
 * the UC on the grant-detail page — NOT in the lifecycle `status` column
 * (which stays "submitted"). Reading only `status` undercounted a UC that had
 * just been verified. Prefer the validation decision when one has been made,
 * mapping "validated" → the web read model's "verified".
 */
export function resolveUcWebStatus(lifecycleStatus: string, validationStatus: string): "pending" | "submitted" | "verified" | "rejected" {
  if (validationStatus === "validated") return "verified";
  if (validationStatus === "rejected") return "rejected";
  return mapUcStatus(lifecycleStatus);
}

export async function getUcStatements(tenantId: string, applicationId: string) {
  return repo.listUcByApplication(applicationId, tenantId);
}

/**
 * PERF-005: was a 2N+1 — one findApplicationById + one findBeneficiaryById
 * PER utilisation-certificate row. Now: the outer list (possibly
 * cache-served) plus exactly 2 batch queries total regardless of row count.
 * Response shape and per-row field mapping are unchanged from the original
 * loop.
 */
export async function listUtilizationCerts(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grant_ucs", `list:${limit}`),
    () => repo.listUcByTenant(tenantId, limit),
  );
  const list = rows ?? [];

  const applicationIds = [...new Set(list.map((row) => row.applicationId))];
  const applications = await applicationRepo.findApplicationsByIds(applicationIds, tenantId);
  const applicationById = new Map(applications.map((a) => [a.id, a]));

  const beneficiaryIds = [...new Set(applications.map((a) => a.beneficiaryId))];
  const beneficiaries = await beneficiaryRepo.findBeneficiariesByIds(beneficiaryIds, tenantId);
  const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b]));

  return list.map((row) => {
    const application = applicationById.get(row.applicationId) ?? null;
    const beneficiary = application ? beneficiaryById.get(application.beneficiaryId) ?? null : null;
    return {
      id: row.id,
      ucNo: row.ucRef ?? row.id.slice(0, 8).toUpperCase(),
      grantId: row.applicationId,
      grantNo: application?.grantNo ?? "—",
      granteeName: beneficiary?.name ?? "—",
      amount: minorToAmount(row.utilisedMinor),
      periodFrom: `${row.period}-01`,
      periodTo: `${row.period}-28`,
      submittedDate: new Date(row.submittedAt as unknown as string).toISOString().slice(0, 10),
      status: resolveUcWebStatus(row.status, row.validationStatus),
    };
  });
}
