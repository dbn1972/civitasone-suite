/**
 * Opportunity / Pipeline client (BRD §7.7, OP-001..OP-006).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session,
 * device headers). Read loaders return { source: "error" } on failure so
 * screens render "—" + DataSourceBadge instead of fabricating a zero/empty as
 * fact. Normalisers tolerate a bare array OR an { items | data | <named> }
 * wrapper because the backend is being built concurrently (see the OP-001..006
 * contract) — verify actual paths against the merged code.
 *
 * Money is carried as a minor-unit (paise) integer STRING end-to-end. The UI
 * converts a clerk-entered rupee decimal with rupeesToMinorString (no float)
 * and displays with formatMoney. Never do rupee/paise arithmetic with Number.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type OpSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: OpSource;
}

/* --------------------------------------------------------------- helpers -- */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
/** A minor-unit money field may arrive as a number or a string; keep it a string. */
function minorStr(v: unknown): string {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v));
  return "0";
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter((s) => s.length > 0) : [];
}

/** Tolerate bare-array vs { items | data | <named> } wrappers. */
function toArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", ...keys]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/* ======================================================= shared constants == */

/**
 * The catalogue of opportunity fields a pipeline stage can mark mandatory
 * (OP-002 stage config drives OP-003's 422 enforcement). Single source of
 * truth shared by the pipeline editor and the opportunity form.
 */
export const OPP_FIELD_KEYS = [
  "value",
  "probability",
  "product",
  "quantity",
  "competitors",
  "nextStep",
  "expectedCloseDate",
] as const;
export type OppFieldKey = (typeof OPP_FIELD_KEYS)[number];

export const OPP_FIELD_LABELS: Record<OppFieldKey, string> = {
  value: "Deal value",
  probability: "Probability",
  product: "Product",
  quantity: "Quantity",
  competitors: "Competitors",
  nextStep: "Next step",
  expectedCloseDate: "Expected close date",
};

/** OP-006 close outcomes (single source of truth). */
export const CLOSE_OUTCOMES = ["won", "lost", "cancelled", "on_hold"] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

export const CLOSE_OUTCOME_LABELS: Record<CloseOutcome, string> = {
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
  on_hold: "On hold",
};

/* ============================================================ OP-002 types == */

export interface PipelineStage {
  key: string;
  name: string;
  /** Fields that must be present before an opportunity can enter this stage. */
  mandatoryFields: OppFieldKey[];
  /** A gate stage requires an explicit review before the deal may pass. */
  gate: boolean;
  product?: string;
  region?: string;
  businessUnit?: string;
}

export interface Pipeline {
  id?: string;
  name: string;
  stages: PipelineStage[];
  enabled: boolean;
}

export function normaliseStage(raw: unknown): PipelineStage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  const key = str(r.key) || name.toLowerCase().replace(/\s+/g, "_");
  if (!name && !key) return null;
  const fields = strArray(r.mandatoryFields).filter((f): f is OppFieldKey =>
    (OPP_FIELD_KEYS as readonly string[]).includes(f),
  );
  return {
    key,
    name: name || key,
    mandatoryFields: fields,
    gate: bool(r.gate),
    product: str(r.product) || undefined,
    region: str(r.region) || undefined,
    businessUnit: str(r.businessUnit) || undefined,
  };
}

export function normalisePipeline(raw: unknown): Pipeline | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name && !r.id) return null;
  const stages = toArray(r.stages, "stages")
    .map(normaliseStage)
    .filter((s): s is PipelineStage => s !== null);
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    name,
    stages,
    enabled: bool(r.enabled, true),
  };
}

export function normalisePipelines(raw: unknown): Pipeline[] {
  return toArray(raw, "pipelines")
    .map(normalisePipeline)
    .filter((p): p is Pipeline => p !== null);
}

export async function getPipelines(): Promise<LoaderResult<Pipeline[]>> {
  try {
    const res = await browserFetch("v1/crm/pipelines");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normalisePipelines(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createPipeline(pipeline: Pipeline): Promise<void> {
  const res = await browserFetch("v1/crm/pipelines", {
    method: "POST",
    body: JSON.stringify(pipeline),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updatePipeline(id: string, pipeline: Pipeline): Promise<void> {
  const res = await browserFetch(`v1/crm/pipelines/${id}`, {
    method: "PUT",
    body: JSON.stringify(pipeline),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deletePipeline(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/pipelines/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ============================================================ OP-003 types == */

export interface Opportunity {
  id?: string;
  name: string;
  pipelineId: string;
  stage: string;
  /** Minor units (paise), as a string — never a float. */
  valueMinor: string;
  probability: number;
  product: string;
  quantity: number;
  competitors: string[];
  nextStep: string;
  expectedCloseDate: string;
  accountId?: string;
  status?: string;
  outcome?: CloseOutcome | null;
  /** Optimistic-concurrency version — required by the stage-move endpoint. */
  version?: number;
}

export function normaliseOpportunity(raw: unknown): Opportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : undefined;
  const name = str(r.name);
  if (!id && !name) return null;
  return {
    id,
    name,
    pipelineId: str(r.pipelineId),
    stage: str(r.stage),
    // Tolerate value | valueMinor | valueDisplay-less payloads.
    valueMinor: minorStr(r.valueMinor ?? r.value),
    probability: num(r.probability),
    product: str(r.product),
    quantity: num(r.quantity),
    competitors: strArray(r.competitors),
    nextStep: str(r.nextStep),
    expectedCloseDate: str(r.expectedCloseDate ?? r.closeDate),
    accountId: str(r.accountId) || undefined,
    status: str(r.status) || undefined,
    outcome: (CLOSE_OUTCOMES as readonly string[]).includes(str(r.outcome))
      ? (str(r.outcome) as CloseOutcome)
      : null,
    ...(typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1
      ? { version: r.version }
      : {}),
  };
}

export function normaliseOpportunities(raw: unknown): Opportunity[] {
  return toArray(raw, "deals", "opportunities")
    .map(normaliseOpportunity)
    .filter((o): o is Opportunity => o !== null);
}

/**
 * Thrown when a stage change (or close) is rejected because the target stage
 * requires fields the opportunity has not supplied — the backend replies 422
 * MANDATORY_STAGE_FIELDS_MISSING. Carries the field list so the UI can point
 * at exactly which inputs to complete.
 */
export class MandatoryFieldsError extends Error {
  readonly missingFields: string[];
  constructor(message: string, missingFields: string[]) {
    super(message);
    this.name = "MandatoryFieldsError";
    this.missingFields = missingFields;
  }
}

/** Pull the missing-field list out of a 422 body, tolerating shapes. */
export function extractMissingFields(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const candidates =
    b.missingFields ?? b.fields ?? (b.details as Record<string, unknown> | undefined)?.missingFields;
  return strArray(candidates);
}

async function throwStageError(res: Response): Promise<never> {
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    /* no body */
  }
  const code =
    (body && typeof body === "object" && str((body as Record<string, unknown>).code)) || "";
  if (res.status === 422 && (code === "MANDATORY_STAGE_FIELDS_MISSING" || extractMissingFields(body).length > 0)) {
    throw new MandatoryFieldsError(
      "This stage needs more information before the opportunity can move into it.",
      extractMissingFields(body),
    );
  }
  throw new Error(await errorMessageFromResponse(res));
}

/**
 * Serialize an Opportunity into the shape the deal write validators accept:
 * minor-unit money crosses as an integer (paise fit an int exactly), and empty
 * optional strings are omitted because the validators enforce min-length /
 * ISO-date on any value that IS present.
 */
function toDealWriteBody(opp: Opportunity): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: opp.name,
    stage: opp.stage,
    valueMinor: Number(opp.valueMinor || "0"),
    probability: opp.probability,
    quantity: opp.quantity,
    competitors: opp.competitors,
  };
  if (opp.pipelineId) body.pipelineId = opp.pipelineId;
  if (opp.product) body.product = opp.product;
  if (opp.nextStep) body.nextStep = opp.nextStep;
  if (/^\d{4}-\d{2}-\d{2}$/.test(opp.expectedCloseDate)) body.expectedCloseDate = opp.expectedCloseDate;
  return body;
}

export async function createOpportunity(opp: Opportunity): Promise<void> {
  const res = await browserFetch("v1/crm/deals", { method: "POST", body: JSON.stringify(toDealWriteBody(opp)) });
  if (!res.ok) await throwStageError(res);
}

export async function updateOpportunity(id: string, opp: Opportunity): Promise<void> {
  const res = await browserFetch(`v1/crm/deals/${id}`, { method: "PATCH", body: JSON.stringify(toDealWriteBody(opp)) });
  if (!res.ok) await throwStageError(res);
}

/** OP-003 stage move — 422 MANDATORY_STAGE_FIELDS_MISSING surfaces the fields. */
export async function changeOpportunityStage(id: string, stage: string, version?: number): Promise<void> {
  const res = await browserFetch(`v1/crm/deals/${id}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ stage, version: version && version >= 1 ? version : 1 }),
  });
  if (!res.ok) await throwStageError(res);
}

/* ============================================================ OP-006 close == */

export interface CloseRequest {
  outcome: CloseOutcome;
  reason: string;
  competitor?: string;
}

export async function closeOpportunity(id: string, req: CloseRequest): Promise<void> {
  const res = await browserFetch(`v1/crm/deals/${id}/close`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) await throwStageError(res);
}

/* ============================================================ OP-004 views == */

export interface KanbanColumn {
  stage: string;
  stageName: string;
  deals: Opportunity[];
}

export function normaliseKanban(raw: unknown): KanbanColumn[] {
  const cols = toArray(raw, "columns", "stages");
  const out: KanbanColumn[] = [];
  for (const c of cols) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const stage = str(r.stage) || str(r.key);
    if (!stage) continue;
    out.push({
      stage,
      stageName: str(r.stageName) || str(r.name) || stage,
      deals: normaliseOpportunities(r.deals ?? r.items ?? r.opportunities),
    });
  }
  return out;
}

export async function getKanban(pipelineId: string): Promise<LoaderResult<KanbanColumn[]>> {
  try {
    const res = await browserFetch(`v1/crm/deals/kanban?pipelineId=${encodeURIComponent(pipelineId)}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseKanban(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export interface FunnelRow {
  stage: string;
  stageName: string;
  count: number;
  valueMinor: string;
}

export function normaliseFunnel(raw: unknown): FunnelRow[] {
  return toArray(raw, "funnel", "stages")
    .map((c): FunnelRow | null => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      const stage = str(r.stage) || str(r.key);
      if (!stage) return null;
      return {
        stage,
        stageName: str(r.stageName) || str(r.name) || stage,
        count: num(r.count),
        valueMinor: minorStr(r.valueMinor ?? r.value),
      };
    })
    .filter((r): r is FunnelRow => r !== null);
}

export async function getFunnel(pipelineId: string): Promise<LoaderResult<FunnelRow[]>> {
  try {
    const res = await browserFetch(`v1/crm/deals/funnel?pipelineId=${encodeURIComponent(pipelineId)}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseFunnel(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getOpportunities(pipelineId?: string): Promise<LoaderResult<Opportunity[]>> {
  const q = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : "";
  try {
    const res = await browserFetch(`v1/crm/deals${q}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseOpportunities(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export interface CalendarEntry {
  id: string;
  name: string;
  expectedCloseDate: string;
  valueMinor: string;
  stage: string;
}

export function normaliseCalendar(raw: unknown): CalendarEntry[] {
  return toArray(raw, "entries", "deals")
    .map((c): CalendarEntry | null => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      const id = str(r.id);
      const date = str(r.expectedCloseDate ?? r.closeDate);
      if (!id || !date) return null;
      return {
        id,
        name: str(r.name),
        expectedCloseDate: date,
        valueMinor: minorStr(r.valueMinor ?? r.value),
        stage: str(r.stage),
      };
    })
    .filter((c): c is CalendarEntry => c !== null);
}

export async function getCalendar(pipelineId?: string): Promise<LoaderResult<CalendarEntry[]>> {
  const q = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : "";
  try {
    const res = await browserFetch(`v1/crm/deals/calendar${q}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseCalendar(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/* ========================================================== OP-005 ageing == */

export interface StageAgeingRow {
  id: string;
  name: string;
  stage: string;
  stageName: string;
  daysInStage: number;
  limitDays: number;
  /** How far past the configured limit (days), never negative. */
  exceededBy: number;
}

export function normaliseAgeing(raw: unknown): StageAgeingRow[] {
  return toArray(raw, "rows", "deals")
    .map((c): StageAgeingRow | null => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      const id = str(r.id);
      if (!id) return null;
      const daysInStage = num(r.daysInStage);
      const limitDays = num(r.limitDays);
      const exceededBy = r.exceededBy !== undefined ? num(r.exceededBy) : Math.max(0, daysInStage - limitDays);
      return {
        id,
        name: str(r.name),
        stage: str(r.stage),
        stageName: str(r.stageName) || str(r.stage),
        daysInStage,
        limitDays,
        exceededBy: Math.max(0, exceededBy),
      };
    })
    .filter((r): r is StageAgeingRow => r !== null);
}

export async function getStageAgeing(pipelineId?: string): Promise<LoaderResult<StageAgeingRow[]>> {
  const q = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : "";
  try {
    const res = await browserFetch(`v1/crm/deals/stage-ageing${q}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseAgeing(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export interface StageLimit {
  id?: string;
  pipelineId?: string;
  stage: string;
  limitDays: number;
}

export function normaliseStageLimit(raw: unknown): StageLimit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stage = str(r.stage);
  if (!stage) return null;
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    pipelineId: str(r.pipelineId) || undefined,
    stage,
    limitDays: num(r.maxDays ?? r.limitDays),
  };
}

export function normaliseStageLimits(raw: unknown): StageLimit[] {
  return toArray(raw, "limits", "stageLimits")
    .map(normaliseStageLimit)
    .filter((s): s is StageLimit => s !== null);
}

/** The backend upserts stage limits keyed on (pipelineId, stage) via PUT. */
function toStageLimitBody(limit: StageLimit): Record<string, unknown> {
  return {
    ...(limit.pipelineId ? { pipelineId: limit.pipelineId } : {}),
    stage: limit.stage,
    maxDays: limit.limitDays,
    enabled: true,
  };
}

export async function getStageLimits(): Promise<LoaderResult<StageLimit[]>> {
  try {
    const res = await browserFetch("v1/crm/stage-limits");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseStageLimits(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createStageLimit(limit: StageLimit): Promise<void> {
  const res = await browserFetch("v1/crm/stage-limits", {
    method: "PUT",
    body: JSON.stringify(toStageLimitBody(limit)),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateStageLimit(_id: string, limit: StageLimit): Promise<void> {
  // Same upsert endpoint as create — the backend keys on (pipelineId, stage).
  const res = await browserFetch("v1/crm/stage-limits", {
    method: "PUT",
    body: JSON.stringify(toStageLimitBody(limit)),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteStageLimit(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/stage-limits/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
