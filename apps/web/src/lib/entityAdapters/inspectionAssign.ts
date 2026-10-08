import type { EntityOption } from "@/app/_components/ds";

/**
 * EntityPicker adapters for the inspection assignment form
 * (GAP-INSPECTION-ASSIGNMENTS-01). Each wraps an EXISTING inspection-service
 * read endpoint — no new backend route — in the generic {id,label,sublabel}
 * search(q)/resolve(ids) contract, so AssignmentActions.tsx can replace its
 * four raw "UUID" text boxes with pickers that show names and send real ids:
 *
 *   • entities (universe.regulated_entities) — GET /v1/inspection/entities?q=…
 *     has real server-side full-text search (universe/queries.ts), so search()
 *     passes q straight through.
 *   • inspection types (universe.inspection_types) — GET /v1/inspection/types
 *     is a bounded paginated list with no q param, so fetch one page and filter
 *     client-side (same pattern as lib/entityAdapters/designation.ts).
 *   • inspections (execution.inspections) — GET /v1/inspection/inspections is a
 *     bounded paginated list with no q param; fetch and filter client-side.
 *     An inspection has no human code, so it is labelled honestly by state +
 *     scheduled/created date with a short id, never a guessed name.
 *
 * Inspectors are resolved via the shared user directory
 * (lib/directory/searchUsers.ts), NOT here — every module reuses that one
 * directory per FIXER-RULES, rather than building a second people search.
 *
 * All adapters fail soft to [] on a non-ok response (the picker shows
 * "No matches" rather than throwing).
 */

const PAGE = "pageSize=200";

function rowsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ── Regulated entities ──────────────────────────────────────────────────────

function entityToOption(row: Record<string, unknown>): EntityOption | null {
  const id = str(row.id);
  if (!id) return null;
  const name = str(row.name);
  const reg = str(row.registrationNo);
  const type = str(row.entityType);
  return {
    id,
    label: name || reg || id,
    sublabel: [reg, type].filter(Boolean).join(" · ") || undefined,
  };
}

export async function searchInspectionEntities(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const qs = new URLSearchParams({ q: query.trim(), pageSize: "20" });
  const res = await fetch(`/api/proxy/v1/inspection/entities?${qs.toString()}`, { signal });
  if (!res.ok) return [];
  return rowsOf(await res.json())
    .map(entityToOption)
    .filter((o): o is EntityOption => o !== null);
}

export async function resolveInspectionEntities(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const out: EntityOption[] = [];
  for (const id of ids) {
    const res = await fetch(`/api/proxy/v1/inspection/entities/${encodeURIComponent(id)}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const opt = body.data ? entityToOption(body.data) : null;
    if (opt) out.push(opt);
  }
  return out;
}

// ── Inspection types ────────────────────────────────────────────────────────

function typeToOption(row: Record<string, unknown>): EntityOption | null {
  const id = str(row.id);
  if (!id) return null;
  const name = str(row.name);
  const code = str(row.code);
  return { id, label: name || code || id, sublabel: code && name ? code : undefined };
}

async function fetchTypes(signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const res = await fetch(`/api/proxy/v1/inspection/types?${PAGE}`, signal ? { signal } : undefined);
  if (!res.ok) return [];
  return rowsOf(await res.json());
}

export async function searchInspectionTypes(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchTypes(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => str(r.name).toLowerCase().includes(q) || str(r.code).toLowerCase().includes(q))
    : rows;
  return filtered.map(typeToOption).filter((o): o is EntityOption => o !== null);
}

export async function resolveInspectionTypes(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchTypes();
  return rows
    .filter((r) => idSet.has(str(r.id)))
    .map(typeToOption)
    .filter((o): o is EntityOption => o !== null);
}

// ── Inspections ──────────────────────────────────────────────────────────────

function inspectionToOption(row: Record<string, unknown>): EntityOption | null {
  const id = str(row.id);
  if (!id) return null;
  const state = str(row.state);
  const when = str(row.scheduledDate) || str(row.createdAt);
  const shortId = id.slice(0, 8);
  // No human code exists on an inspection; label it honestly by state + date,
  // with a copyable short id — never a fabricated name.
  const label = [state || "inspection", when ? when.slice(0, 10) : null].filter(Boolean).join(" · ");
  return { id, label: `${label} (#${shortId})`, sublabel: `#${shortId}…` };
}

async function fetchInspections(signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const res = await fetch(`/api/proxy/v1/inspection/inspections?${PAGE}`, signal ? { signal } : undefined);
  if (!res.ok) return [];
  return rowsOf(await res.json());
}

export async function searchInspections(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchInspections(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => str(r.id).toLowerCase().includes(q) || str(r.state).toLowerCase().includes(q))
    : rows;
  return filtered.map(inspectionToOption).filter((o): o is EntityOption => o !== null);
}

export async function resolveInspections(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const out: EntityOption[] = [];
  for (const id of ids) {
    const res = await fetch(`/api/proxy/v1/inspection/inspections/${encodeURIComponent(id)}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const opt = body.data ? inspectionToOption(body.data) : null;
    if (opt) out.push(opt);
  }
  return out;
}
