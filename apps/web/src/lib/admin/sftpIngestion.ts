/**
 * External-Lead SFTP Ingestion — shared pure logic (BRD §9 #12).
 *
 * The admin Integrations drawer configures the `sftp` connector; for lead
 * ingestion it also stores a handful of NON-SECRET fields in the connector
 * `config` (inbound path, file pattern, archive path, a lead-source toggle +
 * label, and a file-column → lead-field mapping) and surfaces the ingestion
 * runs produced by the backend sweeper.
 *
 * Everything here is deliberately pure/unit-testable: normalisers, the
 * config validator, mapping (rows <-> object) transforms, run status → label/
 * variant, and the two BFF loaders. Read loaders return { source: "error" } on
 * failure so the UI renders "—" + DataSourceBadge instead of fabricating a
 * "0 rows imported" as if it were fact. The backend lane is building the
 * endpoints concurrently — the normalisers tolerate wrapper/field drift and the
 * assumed contract is documented per function.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type IngestionSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: IngestionSource;
}

/* ============================================================ lead fields === */

/** The lead fields an inbound file column may be mapped onto. */
export const LEAD_FIELDS = ["name", "email", "mobile", "company", "city"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  name: "Name",
  email: "Email",
  mobile: "Mobile",
  company: "Company",
  city: "City",
};

/** The two contact fields, at least one of which must be mapped. */
export const CONTACT_FIELDS: readonly LeadField[] = ["email", "mobile"];

export function isLeadField(v: unknown): v is LeadField {
  return typeof v === "string" && (LEAD_FIELDS as readonly string[]).includes(v);
}

/* ============================================================ small utils === */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}

/* ========================================================= column mapping === */

/**
 * One editable mapping row. Kept as an ordered array in the editor (so add/
 * remove and blank rows behave predictably); persisted as a plain object.
 */
export interface MappingRow {
  /**
   * Stable per-row identity for React reconciliation, stamped at creation
   * (hydration / add). Persistence ignores it — only column/field are stored.
   * Optional so plain { column, field } literals remain valid inputs.
   */
  id?: string;
  column: string;
  field: LeadField;
}

let mappingRowSeq = 0;

/** Create an editor row with a stable id (used by add + hydration). */
export function newMappingRow(field: LeadField = LEAD_FIELDS[0], column = ""): MappingRow {
  return { id: `mr-${++mappingRowSeq}`, column, field };
}

/** Editor draft of the six lead-ingestion config fields. */
export interface IngestionConfigDraft {
  inboundPath: string;
  filePattern: string;
  archivePath: string;
  leadSource: boolean;
  leadSourceLabel: string;
  mapping: MappingRow[];
}

/**
 * Serialise editor rows → the persisted `columnMapping` object
 * ({ "File Column": "email" }). Blank column names are dropped; on a duplicate
 * column the last row wins (matches how a plain object would collapse).
 */
export function mappingRowsToObject(rows: MappingRow[]): Record<string, LeadField> {
  const out: Record<string, LeadField> = {};
  for (const row of rows) {
    const col = row.column.trim();
    if (col && isLeadField(row.field)) out[col] = row.field;
  }
  return out;
}

/** Inflate a persisted `columnMapping` object → ordered editor rows. */
export function mappingObjectToRows(raw: unknown): MappingRow[] {
  if (!raw || typeof raw !== "object") return [];
  const rows: MappingRow[] = [];
  for (const [column, field] of Object.entries(raw as Record<string, unknown>)) {
    if (isLeadField(field)) rows.push(newMappingRow(field, column));
  }
  return rows;
}

/** True when at least one non-blank column maps to Email or Mobile. */
export function hasContactMapping(rows: MappingRow[]): boolean {
  return rows.some(
    (r) => r.column.trim().length > 0 && (r.field === "email" || r.field === "mobile"),
  );
}

/* ============================================================= validation === */

export interface ConfigErrors {
  leadSourceLabel?: string;
  mapping?: string;
}

/**
 * Validate the lead-ingestion config. Rules only bite when the `leadSource`
 * toggle is on (a plain SFTP file drop with no lead promotion needs none of
 * this): a non-empty source label is required, and at least one column must be
 * mapped to Email OR Mobile so a lead can actually be contacted/deduped.
 * Returns an errors object; empty object means valid.
 */
export function validateIngestionConfig(draft: IngestionConfigDraft): ConfigErrors {
  const errors: ConfigErrors = {};
  if (!draft.leadSource) return errors;

  if (draft.leadSourceLabel.trim().length === 0) {
    errors.leadSourceLabel = "A source label is required when lead ingestion is on.";
  }
  if (!hasContactMapping(draft.mapping)) {
    errors.mapping = "Map at least one column to Email or Mobile so leads can be contacted.";
  }
  return errors;
}

export function isConfigValid(draft: IngestionConfigDraft): boolean {
  return Object.keys(validateIngestionConfig(draft)).length === 0;
}

/**
 * Build the NON-SECRET config fields to merge into the connector payload when
 * the provider is `sftp`. Empty optional strings are omitted; the mapping is
 * emitted as the persisted object shape.
 */
export function buildSftpConfigPatch(draft: IngestionConfigDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    inboundPath: draft.inboundPath.trim(),
    filePattern: draft.filePattern.trim(),
    leadSource: draft.leadSource,
    columnMapping: mappingRowsToObject(draft.mapping),
  };
  const archive = draft.archivePath.trim();
  if (archive) patch.archivePath = archive;
  if (draft.leadSource) patch.leadSourceLabel = draft.leadSourceLabel.trim();
  return patch;
}

/** Read the lead-ingestion fields back out of a stored connector config. */
export function extractIngestionDraft(config: Record<string, unknown> | undefined): IngestionConfigDraft {
  const c = config ?? {};
  return {
    inboundPath: str(c.inboundPath),
    filePattern: str(c.filePattern),
    archivePath: str(c.archivePath),
    leadSource: bool(c.leadSource),
    leadSourceLabel: str(c.leadSourceLabel),
    mapping: mappingObjectToRows(c.columnMapping),
  };
}

/* ============================================================ run statuses === */

export const RUN_STATUSES = ["running", "succeeded", "failed", "partial"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  partial: "Partial",
};

/** pill class (icon+label — colour is never the only signal). */
const RUN_STATUS_VARIANTS: Record<RunStatus, string> = {
  running: "info",
  succeeded: "ok",
  failed: "bad",
  partial: "warn",
};

const RUN_STATUS_ICONS: Record<RunStatus, string> = {
  running: "⏳",
  succeeded: "✓",
  failed: "✗",
  partial: "◑",
};

export function runStatusLabel(status: string): string {
  return isRunStatus(status) ? RUN_STATUS_LABELS[status] : status || "Unknown";
}
export function runStatusVariant(status: string): string {
  return isRunStatus(status) ? RUN_STATUS_VARIANTS[status] : "info";
}
export function runStatusIcon(status: string): string {
  return isRunStatus(status) ? RUN_STATUS_ICONS[status] : "•";
}

/* ================================================================== runs === */

export interface IngestionRun {
  id: string;
  status: string;
  filesSeen: number;
  rowsTotal: number;
  rowsCreated: number;
  rowsFailed: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Tolerant normaliser — the backend is being built concurrently. */
export function normaliseRun(raw: unknown, idx = 0): IngestionRun {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: str(r.id) || `run-${idx}`,
    // Do NOT coerce a missing/empty status to "running": a malformed row must
    // not masquerade as a healthy live sweep. Left "", it falls through to the
    // runStatusLabel/Variant/Icon "Unknown"/neutral fallbacks.
    status: str(r.status),
    filesSeen: num(r.filesSeen),
    rowsTotal: num(r.rowsTotal),
    rowsCreated: num(r.rowsCreated),
    rowsFailed: num(r.rowsFailed),
    error: str(r.error) || null,
    startedAt: str(r.startedAt) || null,
    finishedAt: str(r.finishedAt) || null,
  };
}

/** Tolerate a bare array OR an { runs | items | data } wrapper. */
export function normaliseRuns(raw: unknown): IngestionRun[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object") {
    for (const k of ["runs", "items", "data"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        arr = v;
        break;
      }
    }
  }
  return arr.map((r, i) => normaliseRun(r, i));
}

/* ============================================================ formatting ==== */

/** Human date+time; empty for a missing timestamp (never fabricate "now"). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ================================================================ loaders === */

function base(provider: string, env: string): string {
  return `v1/admin/integrations/${encodeURIComponent(provider)}/${encodeURIComponent(env)}`;
}

/**
 * GET .../ingestions → recent ingestion runs.
 * On any failure returns { data: [], source: "error" } so the caller shows the
 * saved-info badge and an em-dash instead of a fabricated empty/zero run list.
 */
export async function getIngestionRuns(
  provider: string,
  env: string,
): Promise<LoaderResult<IngestionRun[]>> {
  try {
    const res = await browserFetch(`${base(provider, env)}/ingestions`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseRuns(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export interface TriggerResult {
  ok: boolean;
  error: string | null;
}

/**
 * Friendly, actionable messages for the BE's 409 `{ status:"skipped", reason }`
 * response — the connector can't run for a reason it already computed, so we
 * surface that reason rather than a bare "API_ERROR: 409". `secret_unavailable`
 * arrives as `secret_unavailable:<detail>`, so this is matched by prefix.
 */
export function skipReasonMessage(reason: string): string {
  const r = reason.trim();
  if (r === "connector_not_enabled") return "The connector is disabled — enable it and save before running.";
  if (r === "not_a_lead_source") return "This connector isn't marked as a lead source. Turn on lead ingestion and save first.";
  if (r === "connector_incomplete") return "Ingestion config is incomplete. Fill in the connection and lead-ingestion settings, then save.";
  if (r.startsWith("secret_unavailable")) return "The connector secret is unavailable. Set the SFTP private key and save before running.";
  return r ? `Ingestion was skipped: ${r}` : "Ingestion was skipped.";
}

/** POST .../ingest → fire a one-off sweep (async/accepted). */
export async function triggerIngestion(provider: string, env: string): Promise<TriggerResult> {
  try {
    const res = await browserFetch(`${base(provider, env)}/ingest`, {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) {
      // The BE returns 409 { status:"skipped", reason } when the connector
      // can't run — surface that actionable reason, not a bare status.
      if (res.status === 409) {
        try {
          const body = (await res.clone().json()) as { status?: string; reason?: string };
          if (body?.status === "skipped" && typeof body.reason === "string") {
            return { ok: false, error: skipReasonMessage(body.reason) };
          }
        } catch {
          // not the skipped shape — fall through to the generic extractor
        }
      }
      return { ok: false, error: await errorMessageFromResponse(res) };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start ingestion" };
  }
}
