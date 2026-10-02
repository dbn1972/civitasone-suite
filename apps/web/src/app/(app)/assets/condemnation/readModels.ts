import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapAssetSummaries } from "@/app/_data/apiMappers";
import type { AssetOption, AuctionRecord, RecommendationRecord, SurveyRecord } from "./CondemnationWorkflow";

/**
 * Read-model mappers for the condemnation page (GAP-ASSETS-CONDEMNATION-01/02).
 * Money columns arrive as decimal strings (bigint paise serialised by the
 * service's jsonSafe hook); a malformed row is dropped, never coerced.
 */
function rowsOf(payload: unknown): Record<string, unknown>[] | null {
  const raw = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!raw) return null;
  return raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const minor = (v: unknown): string | null =>
  typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
// No usable version -> null, and the row is dropped: never send a guessed
// optimistic-lock version on an irreversible step.
const version = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function mapSurveys(payload: unknown): SurveyRecord[] | null {
  const rows = rowsOf(payload);
  if (!rows) return null;
  return rows.flatMap((r) => {
    const id = str(r.id);
    const assetId = str(r.assetId);
    const v = version(r.version);
    if (!id || !assetId || v === null) return [];
    return [{ id, assetId, status: str(r.status) ?? "draft", condition: str(r.condition) ?? "—", surveyDate: str(r.surveyDate) ?? "", version: v }];
  });
}

export function mapRecommendations(payload: unknown): RecommendationRecord[] | null {
  const rows = rowsOf(payload);
  if (!rows) return null;
  return rows.flatMap((r) => {
    const id = str(r.id);
    const assetId = str(r.assetId);
    const surveyId = str(r.surveyId);
    const v = version(r.version);
    if (!id || !assetId || !surveyId || v === null) return [];
    return [{
      id, assetId, surveyId,
      decision: str(r.decision) ?? "—",
      status: str(r.status) ?? "pending",
      version: v,
      reserveValueMinor: minor(r.reserveValueMinor),
      floorValueMinor: minor(r.floorValueMinor),
    }];
  });
}

export function mapAuctions(payload: unknown): AuctionRecord[] | null {
  const rows = rowsOf(payload);
  if (!rows) return null;
  return rows.flatMap((r) => {
    const id = str(r.id);
    const assetId = str(r.assetId);
    const recommendationId = str(r.recommendationId);
    const reserve = minor(r.reserveValueMinor);
    const v = version(r.version);
    if (!id || !assetId || !recommendationId || reserve === null || v === null) return [];
    return [{ id, assetId, recommendationId, status: str(r.status) ?? "pending", version: v, reserveValueMinor: reserve }];
  });
}

export function mapAssetOptions(payload: unknown): AssetOption[] | null {
  const assets = mapAssetSummaries(payload);
  if (!assets) return null;
  return assets.map((a) => ({ id: a.id, label: `${a.assetCode} · ${a.name}` }));
}

export async function loadList<T>(path: string, key: string, map: (p: unknown) => T[] | null): Promise<LoaderResult<T[]>> {
  return fetchJson<unknown, T[]>(path, [], { telemetryKey: key, mapResponse: map });
}

