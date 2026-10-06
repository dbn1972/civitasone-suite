/**
 * metadata route-group loaders — use shared apiClient (not missing @/app/_lib/api).
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";

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
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

/**
 * GAP-METADATA-ENTITIES-03: the metadata-service DTOs (verified against
 * services/metadata-service/src/modules/*) carry `apiName`, `label`,
 * `pluralLabel`, `description`, `fieldType`, `name`, and an `isActive` boolean
 * (plus `publishedAt`) rather than a free-text `status` string. Map the active
 * flag to a StatusPill-friendly "active"/"inactive" token and recognise
 * `apiName`/`fieldType` so a field/rule/layout row shows a human label and type
 * instead of only its id. Still falls back to the generic shapes
 * (status/state/name/title) so an unrelated envelope keeps mapping as before.
 */
function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.key) ?? toText(row.code) ?? toText(row.apiName) ?? `row-${index + 1}`;
    const label = toText(row.name) ?? toText(row.title) ?? toText(row.label) ?? toText(row.apiName) ?? id;
    const sublabel =
          toText(row.description) ??
          toText(row.fieldType) ??
          toText(row.errorMessage) ??
          toText(row.expression) ??
          toText(row.layoutType) ??
          toText(row.type) ??
          toText(row.entityKey);
    const status =
      toText(row.status) ??
      toText(row.state) ??
      (typeof row.isActive === "boolean" ? (row.isActive ? "active" : "inactive") : undefined);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
    });
  }
  return mapped;
}

function loader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getMetadataEntities = loader("/api/v1/metadata/entities", "metadata.entities");
export const getMetadataFields = loader("/api/v1/metadata/fields", "metadata.fields");
export const getMetadataRules = loader("/api/v1/metadata/rules", "metadata.rules");
export const getMetadataRecords = loader("/api/v1/metadata/records", "metadata.records");
export const getMetadataForms = loader("/api/v1/metadata/forms", "metadata.forms");

/**
 * GAP-METADATA-{FIELDS,RULES,RECORDS,FORMS}-02/-03: the metadata-service exposes
 * fields, validation rules, records and layouts/forms ONLY entity-scoped
 * (`GET /v1/metadata/entities/:entityId/{fields,validation-rules,records,layouts}`
 * — verified in services/metadata-service/src/modules/*; there is NO top-level
 * `/v1/metadata/fields|rules|records|forms` list route). So the drill-down the
 * subtitles promised is the real contract: these loaders take an entityId and
 * hit the scoped route. `entityId` is a tenant-local UUID chosen by the user
 * from the entities list, embedded in the path exactly like every other scoped
 * loader in this file. "forms" are layout_definitions (CAP-109), hence /layouts.
 */
function scopedLoader(buildPath: (entityId: string) => string, key: string) {
  return (entityId: string): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(buildPath(entityId), [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getFieldsForEntity = scopedLoader(
  (entityId) => `/api/v1/metadata/entities/${encodeURIComponent(entityId)}/fields`,
  "metadata.entity.fields",
);
export const getRulesForEntity = scopedLoader(
  (entityId) => `/api/v1/metadata/entities/${encodeURIComponent(entityId)}/validation-rules`,
  "metadata.entity.rules",
);
export const getRecordsForEntity = scopedLoader(
  (entityId) => `/api/v1/metadata/entities/${encodeURIComponent(entityId)}/records`,
  "metadata.entity.records",
);
export const getFormsForEntity = scopedLoader(
  (entityId) => `/api/v1/metadata/entities/${encodeURIComponent(entityId)}/layouts`,
  "metadata.entity.forms",
);
