/**
 * cdp route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls cdp-service through the gateway via cookie-aware fetchJson.
 */
import {
  cdpIdentityLinkListSchema,
  cdpProfileEventListSchema,
  cdpProfileListSchema,
  cdpProfileSchema,
} from "@civitasone/schemas/web";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  CDPIdentityLink,
  CDPProfile,
  CDPProfileEvent,
  ModuleRowSummary,
} from "@civitasone/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

/** Exported for unit tests (see _data.test.ts) — the label/meta fallback ladder
 * is exactly the kind of per-backend-shape logic that regresses silently. */
export function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      // events/taxonomy rows carry the event name as `eventName`, not `name`.
      toText(row.eventName) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.code) ??
      toText(row.type) ??
      toText(row.entityType) ??
      toText(row.direction) ??
      // anonymous-visitor rows have no name at all; `visitorRef` is the
      // service's own short, presentable stand-in for the internal id.
      toText(row.visitorRef) ??
      id;
    const sublabel =
      toText(row.description) ??
      toText(row.status) ??
      toText(row.state) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName) ??
      toText(row.agentId) ??
      toText(row.profileId);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    const meta =
      toText(row.code) ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      // anonymous-visitor rows use lastSeenAt/firstSeenAt instead.
      toText(row.lastSeenAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped;
}

function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getCdpProfiles = moduleLoader("/api/v1/cdp/profiles", "cdp.profiles");
/**
 * Unlike every other list route this loader hits, cdp-service makes `limit`
 * on GET .../anonymous-visitors mandatory rather than defaulting it (see
 * services/cdp-service/tests/cdp-visitor-stitch.test.ts, "limit is
 * mandatory") — a request with no query string 400s. Send it explicitly.
 */
export const getCdpIdentity = moduleLoader("/api/v1/cdp/identity/anonymous-visitors?limit=50", "cdp.identity");
export const getCdpSegments = moduleLoader("/api/v1/cdp/segments", "cdp.segments");
export const getCdpEvents = moduleLoader("/api/v1/cdp/events/taxonomy", "cdp.events");

/**
 * Golden profiles, typed rather than flattened to generic rows, so the list can
 * show attribute and source counts and link into the Customer 360 view.
 */
export async function getCdpProfileList(): Promise<LoaderResult<CDPProfile[]>> {
  return fetchJson("/api/v1/cdp/profiles?limit=200", [] as CDPProfile[], {
    revalidateSeconds: 30,
    telemetryKey: "cdp.profile_list",
    responseSchema: cdpProfileListSchema,
    mapResponse: (payload) => payload.data,
  });
}

/**
 * One golden profile. Returns null on 404 — a merged or absent profile is an
 * expected state the screen renders as "not found", not a loader failure.
 */
export async function getCdpProfile(id: string): Promise<LoaderResult<CDPProfile | null>> {
  return fetchJson(`/api/v1/cdp/profiles/${encodeURIComponent(id)}`, null as CDPProfile | null, {
    revalidateSeconds: 30,
    telemetryKey: "cdp.profile",
    responseSchema: cdpProfileSchema,
    mapResponse: (payload) => payload.data,
  });
}

/** Identifiers resolved onto a profile. Identifier values stay hashed server-side. */
export async function getCdpProfileIdentity(id: string): Promise<LoaderResult<CDPIdentityLink[]>> {
  return fetchJson(`/api/v1/cdp/identity/${encodeURIComponent(id)}`, [] as CDPIdentityLink[], {
    revalidateSeconds: 30,
    telemetryKey: "cdp.profile_identity",
    responseSchema: cdpIdentityLinkListSchema,
    mapResponse: (payload) => payload.data,
  });
}

/** Most recent interaction events for a profile, newest first from the service. */
export async function getCdpProfileTimeline(id: string): Promise<LoaderResult<CDPProfileEvent[]>> {
  return fetchJson(
    `/api/v1/cdp/profiles/${encodeURIComponent(id)}/timeline?limit=25`,
    [] as CDPProfileEvent[],
    {
      revalidateSeconds: 30,
      telemetryKey: "cdp.profile_timeline",
      responseSchema: cdpProfileEventListSchema,
      mapResponse: (payload) => payload.data,
    },
  );
}
