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

function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.key) ?? toText(row.code) ?? `row-${index + 1}`;
    const label = toText(row.name) ?? toText(row.title) ?? toText(row.label) ?? id;
    const sublabel = toText(row.description) ?? toText(row.type) ?? toText(row.entityKey);
    const status = toText(row.status) ?? toText(row.state);
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
