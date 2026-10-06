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
import { formatIndianDateTime } from "@/lib/formatters";
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
    // GAP-CDP-EVENTS-04: `status`/`state` deliberately omitted here — they are
    // already rendered in the dedicated Status column, so including them in the
    // sublabel ("Detail") chain made a status-only row (e.g. a taxonomy row with
    // no description) print the same value twice. Detail now stays empty ("—")
    // when the only thing available is the status.
    const sublabel =
      toText(row.description) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName) ??
      // anonymous-visitor rows carry a deviceType (web/ios/android/kiosk).
      toText(row.deviceType) ??
      toText(row.agentId) ??
      toText(row.profileId);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    // GAP-CDP-EVENTS-01 / IDENTITY-03 / SEGMENTS-04: the date-shaped meta fields
    // (updatedAt/createdAt/lastSeenAt) arrive as raw ISO instants from
    // cdp-service and used to render verbatim (e.g. "2026-09-12T05:41:09.221Z").
    // Format them in IST via the shared formatIndianDateTime (which passes an
    // unparseable value through unchanged rather than printing "Invalid Date").
    // code/currency are business labels, not dates, so they stay as-is.
    const meta =
      toText(row.code) ??
      toText(row.currency) ??
      (toText(row.updatedAt) !== undefined
        ? formatIndianDateTime(toText(row.updatedAt))
        : undefined) ??
      (toText(row.createdAt) !== undefined
        ? formatIndianDateTime(toText(row.createdAt))
        : undefined) ??
      // anonymous-visitor rows use lastSeenAt/firstSeenAt instead.
      (toText(row.lastSeenAt) !== undefined
        ? formatIndianDateTime(toText(row.lastSeenAt))
        : undefined) ??
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
 * GAP-CDP-EVENTS-02 / IDENTITY-01 / SEGMENTS-02,03: a paginated list result.
 * `rows` are the mapped summaries, `total` is the server's own count (meta.total)
 * so the page can say "N of M" instead of presenting a capped page as the whole
 * set, and `limit` is the page size that was requested so a full page can be
 * flagged as "there may be more".
 */
export interface CdpListPage {
  rows: ModuleRowSummary[];
  total: number;
  limit: number;
}

/** Pull meta.total out of the standard `{ data, meta }` envelope, defaulting to the row count. */
function readTotal(payload: unknown, rowCount: number): number {
  if (isRecord(payload) && isRecord(payload.meta) && typeof payload.meta.total === "number") {
    return payload.meta.total;
  }
  return rowCount;
}

function pagedLoader(path: string, key: string, limit: number) {
  const sep = path.includes("?") ? "&" : "?";
  return (offset = 0): Promise<LoaderResult<CdpListPage>> =>
    fetchJson<unknown, CdpListPage>(
      `${path}${sep}limit=${limit}&offset=${offset}`,
      { rows: [], total: 0, limit },
      {
        revalidateSeconds: 30,
        telemetryKey: key,
        mapResponse: (payload) => {
          const rows = mapRows(payload);
          return { rows, total: readTotal(payload, rows.length), limit };
        },
      },
    );
}

/** Paginated taxonomy list for /cdp/events (GAP-CDP-EVENTS-02). */
export const getCdpEventsPage = pagedLoader("/api/v1/cdp/events/taxonomy", "cdp.events_page", 25);
/** Paginated anonymous-visitor list for /cdp/identity (GAP-CDP-IDENTITY-01). */
export const getCdpIdentityPage = pagedLoader("/api/v1/cdp/identity/anonymous-visitors", "cdp.identity_page", 50);
/** Paginated segments list for /cdp/segments (GAP-CDP-SEGMENTS-02,03). */
export const getCdpSegmentsPage = pagedLoader("/api/v1/cdp/segments", "cdp.segments_page", 25);

/**
 * GAP-CDP-SEGMENTS-02: a typed segment-list row that keeps the member count and
 * a short rule summary, which the generic ModuleRowSummary flattening drops. The
 * cdp-service segments list returns these fields in the `{ data, meta }` envelope.
 */
export type CdpSegmentRow = {
  id: string;
  name: string;
  members: string;
  ruleSummary: string;
  status: string;
  updatedAt: string;
};

export interface CdpSegmentListPage {
  rows: CdpSegmentRow[];
  total: number;
  limit: number;
}

function summariseCriteria(criteria: unknown): string {
  if (!isRecord(criteria)) return "—";
  const conditions = criteria.conditions;
  if (Array.isArray(conditions) && conditions.length > 0) {
    const logic = typeof criteria.logic === "string" ? criteria.logic.toUpperCase() : "AND";
    return `${conditions.length} rule${conditions.length === 1 ? "" : "s"} (${logic})`;
  }
  return "—";
}

export function getCdpSegmentList(offset = 0): Promise<LoaderResult<CdpSegmentListPage>> {
  const limit = 25;
  return fetchJson<unknown, CdpSegmentListPage>(
    `/api/v1/cdp/segments?limit=${limit}&offset=${offset}`,
    { rows: [], total: 0, limit },
    {
      revalidateSeconds: 30,
      telemetryKey: "cdp.segment_list",
      mapResponse: (payload) => {
        const raw = extractRows(payload);
        const rows: CdpSegmentRow[] = [];
        for (const r of raw) {
          if (!isRecord(r)) continue;
          const id = toText(r.id);
          if (!id) continue;
          rows.push({
            id,
            name: toText(r.name) ?? id,
            // GAP-CDP-SEGMENTS-02: a missing count is "—", never a fabricated 0.
            members: typeof r.memberCount === "number" ? r.memberCount.toLocaleString("en-IN") : "—",
            ruleSummary: summariseCriteria(r.criteria),
            status: toText(r.status) ?? "—",
            updatedAt: toText(r.updatedAt) ? formatIndianDateTime(toText(r.updatedAt)) : "—",
          });
        }
        return { rows, total: readTotal(payload, rows.length), limit };
      },
    },
  );
}

/**
 * Golden profiles, typed rather than flattened to generic rows, so the list can
 * show attribute and source counts and link into the Customer 360 view.
 *
 * GAP-CDP-PROFILES-04: returns the full server-side `total` (meta.total) and the
 * requested `limit` alongside the (limit-capped) rows, so the page can state
 * "latest N of M" and flag a capped page instead of presenting it as the whole set.
 */
export interface CdpProfileListPage {
  profiles: CDPProfile[];
  total: number;
  limit: number;
}

export async function getCdpProfileList(): Promise<LoaderResult<CdpProfileListPage>> {
  const limit = 200;
  return fetchJson(
    `/api/v1/cdp/profiles?limit=${limit}`,
    { profiles: [] as CDPProfile[], total: 0, limit },
    {
      revalidateSeconds: 30,
      telemetryKey: "cdp.profile_list",
      responseSchema: cdpProfileListSchema,
      mapResponse: (payload) => ({
        profiles: payload.data,
        total: payload.meta?.total ?? payload.data.length,
        limit,
      }),
    },
  );
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
