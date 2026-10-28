import { HttpError } from "../../shared/context.js";
import * as registerRepo from "../register/repo.js";
import * as verificationRepo from "../verification/repo.js";
import * as repo from "./repo.js";
import { assertAssetDisposable, DomainError } from "./domain.js";

/**
 * Synchronous checks the disposal routes run BEFORE a command is queued. The consumers (lifecycle/consumer.ts) still
 * re-assert every rule inside their transaction and silently drop a violating command, so without these a caller
 * got a 202 for a disposal that could never apply (UAT DB test, asset defect 6).
 *
 *  - the asset must exist for the tenant (404)
 *  - it must not already be disposed / written off (409 ASSET_ALREADY_DISPOSED)
 *  - a committee-approved write-off must exist (409 COMMITTEE_APPROVAL_REQUIRED, GFR Rule 173)
 *  - for the eOffice submission, no disposal may already be awaiting a decision (409 DISPOSAL_ALREADY_PENDING)
 */
export async function preflightDisposal(tenantId: string, assetId: string, opts: { checkPending: boolean }): Promise<void> {
  const asset = await registerRepo.findAssetById(assetId, tenantId);
  if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
  try {
    assertAssetDisposable(asset.status);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  if (!(await verificationRepo.findApprovedWriteoff(tenantId, assetId))) {
    throw new HttpError(409, "COMMITTEE_APPROVAL_REQUIRED", "Asset write-off requires committee approval per GFR Rule 173.");
  }
  if (opts.checkPending && (await repo.findActivePendingDisposalRead(tenantId, assetId))) {
    throw new HttpError(409, "DISPOSAL_ALREADY_PENDING", "a disposal for this asset is already awaiting an eOffice decision");
  }
}
