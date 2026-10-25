/**
 * CMDB/Asset linkage client — fetches asset info from asset-service.
 *
 * Graceful degradation: if asset-service is unavailable, log WARN and
 * return an unverified linkage. The ticket is still accepted.
 */
import { pino } from "pino";

const logger = pino({ name: "helpdesk:cmdb" });

const ASSET_SERVICE_URL = process.env.ASSET_SERVICE_URL ?? "http://localhost:3015";
const ASSET_TIMEOUT_MS = Number(process.env.ASSET_TIMEOUT_MS ?? "10000");

export interface AssetInfo {
  id: string;
  name?: string;
  type?: string;
  status?: string;
}

export interface AssetLinkResult {
  assetId: string;
  verified: boolean;
  asset?: AssetInfo;
  error?: string;
}

/**
 * Verify an asset reference by calling asset-service.
 * Returns verified=true with asset info on success, or verified=false
 * with an error description when asset-service is unavailable.
 *
 * NEVER throws — graceful degradation is enforced.
 */
export async function verifyAsset(assetId: string, tenantId: string): Promise<AssetLinkResult> {
  // CLOS3-S5-09: service-to-service credentials, read at call time (never hardcoded).
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) {
    logger.warn({ assetId, tenantId }, "INTERNAL_SERVICE_SECRET unset — cannot verify asset linkage");
    return { assetId, verified: false, error: "asset_service_auth_unconfigured" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);

    // asset-service serves detail at GET /v1/assets/assets/:id (there is no /v1/assets/:id).
    const res = await fetch(`${ASSET_SERVICE_URL}/v1/assets/assets/${encodeURIComponent(assetId)}`, {
      method: "GET",
      headers: {
        "x-internal": "1",
        "x-service-secret": secret,
        "x-tenant-id": tenantId,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      // The route returns the bare asset; tolerate a {data} envelope too.
      const body = await res.json() as AssetInfo & { data?: AssetInfo };
      return {
        assetId,
        verified: true,
        asset: body.data ?? (body.id ? body : { id: assetId }),
      };
    }

    if (res.status === 404) {
      logger.warn({ assetId, tenantId, status: res.status }, "asset not found in asset-service");
      return { assetId, verified: false, error: "asset_not_found" };
    }

    logger.warn({ assetId, tenantId, status: res.status }, "asset-service returned non-OK status");
    return { assetId, verified: false, error: `asset_service_error_${res.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    logger.warn({ assetId, tenantId, err: message }, "asset-service unavailable — accepting ticket with unverified linkage");
    return { assetId, verified: false, error: "asset_service_unavailable" };
  }
}

/**
 * Verify multiple asset references. Each is independently verified.
 * If asset-service is unavailable, all return verified=false gracefully.
 */
export async function verifyAssets(assetIds: string[], tenantId: string): Promise<AssetLinkResult[]> {
  return Promise.all(assetIds.map((id) => verifyAsset(id, tenantId)));
}
