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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);

    const res = await fetch(`${ASSET_SERVICE_URL}/v1/assets/${assetId}`, {
      method: "GET",
      headers: {
        "x-tenant-id": tenantId,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const body = await res.json() as { data?: AssetInfo };
      return {
        assetId,
        verified: true,
        asset: body.data ?? { id: assetId },
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
