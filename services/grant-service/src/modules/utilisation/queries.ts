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

export async function getUcStatements(tenantId: string, applicationId: string) {
  return repo.listUcByApplication(applicationId);
}

export async function listUtilizationCerts(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grant_ucs", `list:${limit}`),
    () => repo.listUcByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const application = await applicationRepo.findApplicationById(row.applicationId);
    const beneficiary = application ? await beneficiaryRepo.findBeneficiaryById(application.beneficiaryId) : null;
    summaries.push({
      id: row.id,
      ucNo: row.ucRef ?? row.id.slice(0, 8).toUpperCase(),
      grantId: row.applicationId,
      grantNo: application?.grantNo ?? "—",
      granteeName: beneficiary?.name ?? "—",
      amount: minorToAmount(row.utilisedMinor),
      periodFrom: `${row.period}-01`,
      periodTo: `${row.period}-28`,
      submittedDate: new Date(row.submittedAt as unknown as string).toISOString().slice(0, 10),
      status: mapUcStatus(row.status),
    });
  }
  return summaries;
}
