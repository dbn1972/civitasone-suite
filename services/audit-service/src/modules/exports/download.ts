import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { PII_EXPORT_ROLES } from "./validators.js";
import { mintDownloadToken } from "./signing.js";
import type { ExportRow } from "./schema.js";

// H1: a download token is only ever handed to a caller who is actually allowed to
// fetch the artifact: the requester, and for PII exports also a PII role.
export function canDownload(ctx: RequestContext, r: Pick<ExportRow, "createdBy" | "includesPii">): boolean {
  const isRequester = r.createdBy === ctx.actorId;
  const piiOk = !r.includesPii || hasAnyRole(ctx, PII_EXPORT_ROLES);
  return isRequester && piiOk;
}

/**
 * Mint a short-lived (EXPORT_DOWNLOAD_TTL_SECONDS, default 15 min) token bound to
 * this requester + export, or null when the caller may not download / it is not ready.
 */
export function downloadGrant(
  ctx: RequestContext,
  r: Pick<ExportRow, "id" | "createdBy" | "includesPii" | "status" | "signedUrl">,
): { token: string; expiresAt: string } | null {
  if (r.status !== "completed" || !r.signedUrl || !canDownload(ctx, r)) return null;
  const { token, expiresAt } = mintDownloadToken({ exportId: r.id, tenantId: ctx.tenantId, actorId: ctx.actorId });
  return { token, expiresAt: expiresAt.toISOString() };
}
