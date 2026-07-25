/**
 * @civitasone/reconciliation — CAP-059 generic cross-system reconciliation engine.
 *
 * Pure, dependency-free comparison of two datasets pulled from different
 * systems (e.g. subledger vs GL, bank statement vs collection register, ERP
 * vs payroll). Aligns rows by an identifier key and compares configured fields
 * by type — counts, amounts, quantities, identifiers, statuses — producing a
 * structured set of "breaks" (exceptions) plus a reconciliation summary.
 *
 * Persistence, scheduling, and the human exception-handling UI belong to a
 * host service; this package supplies the deterministic engine + the exception
 * lifecycle state machine those hosts drive.
 */

export type ReconFieldType = "count" | "amount" | "quantity" | "identifier" | "status";

export interface ReconFieldSpec {
  /** Field name present on both source and target records. */
  field: string;
  type: ReconFieldType;
  /** Allowed absolute difference for numeric (amount/quantity/count) compares. */
  tolerance?: number;
}

export interface ReconConfig {
  /** Field whose value aligns a source row with its target row. */
  keyField: string;
  fields: ReconFieldSpec[];
  sourceSystem?: string;
  targetSystem?: string;
}

export type ReconRecord = Record<string, unknown>;

export type BreakType =
  | "missing_in_target"
  | "missing_in_source"
  | "value_mismatch"
  | "duplicate_key";

export type BreakSeverity = "low" | "medium" | "high";

export interface ReconBreak {
  key: string;
  type: BreakType;
  field?: string;
  fieldType?: ReconFieldType;
  sourceValue?: unknown;
  targetValue?: unknown;
  /** Signed numeric difference (target - source) for numeric mismatches. */
  delta?: number;
  severity: BreakSeverity;
}

export interface ReconSummary {
  sourceSystem: string;
  targetSystem: string;
  sourceCount: number;
  targetCount: number;
  matchedKeys: number;
  breakCount: number;
  byType: Record<BreakType, number>;
  /** True when there are no breaks at all. */
  balanced: boolean;
}

export interface ReconResult {
  summary: ReconSummary;
  breaks: ReconBreak[];
}

const NUMERIC_TYPES: ReadonlySet<ReconFieldType> = new Set(["count", "amount", "quantity"]);

function toKey(value: unknown): string {
  return value == null ? "" : String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  if (typeof value === "bigint") return Number(value);
  return NaN;
}

/** Severity assigned to a value mismatch for a given field type. */
export function severityForField(type: ReconFieldType): BreakSeverity {
  switch (type) {
    case "amount":
    case "status":
      return "high";
    case "identifier":
      return "high";
    case "quantity":
    case "count":
      return "medium";
    default:
      return "low";
  }
}

export interface FieldComparison {
  equal: boolean;
  delta?: number;
}

/** Compare a single field between a source and target value per its spec. */
export function compareField(spec: ReconFieldSpec, sourceValue: unknown, targetValue: unknown): FieldComparison {
  if (NUMERIC_TYPES.has(spec.type)) {
    const a = toNumber(sourceValue);
    const b = toNumber(targetValue);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      // Non-numeric data in a numeric field — fall back to strict compare.
      return { equal: toKey(sourceValue) === toKey(targetValue) };
    }
    const delta = b - a;
    const tolerance = spec.tolerance ?? 0;
    return { equal: Math.abs(delta) <= tolerance, delta };
  }
  // identifier / status — exact string comparison.
  return { equal: toKey(sourceValue) === toKey(targetValue) };
}

function emptyByType(): Record<BreakType, number> {
  return { missing_in_target: 0, missing_in_source: 0, value_mismatch: 0, duplicate_key: 0 };
}

/** Index records by their key, tracking duplicates. */
function indexByKey(records: ReconRecord[], keyField: string): {
  map: Map<string, ReconRecord>;
  duplicates: Set<string>;
} {
  const map = new Map<string, ReconRecord>();
  const duplicates = new Set<string>();
  for (const rec of records) {
    const key = toKey(rec[keyField]);
    if (map.has(key)) {
      duplicates.add(key);
    } else {
      map.set(key, rec);
    }
  }
  return { map, duplicates };
}

/**
 * Reconcile two datasets. Rows are aligned by `config.keyField`; each field in
 * `config.fields` is compared by its type. Returns all breaks plus a summary.
 */
export function reconcile(source: ReconRecord[], target: ReconRecord[], config: ReconConfig): ReconResult {
  const byType = emptyByType();
  const breaks: ReconBreak[] = [];

  const src = indexByKey(source, config.keyField);
  const tgt = indexByKey(target, config.keyField);

  for (const key of src.duplicates) {
    breaks.push({ key, type: "duplicate_key", severity: "high" });
    byType.duplicate_key++;
  }
  for (const key of tgt.duplicates) {
    if (!src.duplicates.has(key)) {
      breaks.push({ key, type: "duplicate_key", severity: "high" });
      byType.duplicate_key++;
    }
  }

  let matchedKeys = 0;

  for (const [key, sRec] of src.map) {
    const tRec = tgt.map.get(key);
    if (!tRec) {
      breaks.push({ key, type: "missing_in_target", severity: "high" });
      byType.missing_in_target++;
      continue;
    }
    matchedKeys++;
    for (const spec of config.fields) {
      const cmp = compareField(spec, sRec[spec.field], tRec[spec.field]);
      if (!cmp.equal) {
        const brk: ReconBreak = {
          key,
          type: "value_mismatch",
          field: spec.field,
          fieldType: spec.type,
          sourceValue: sRec[spec.field],
          targetValue: tRec[spec.field],
          severity: severityForField(spec.type),
        };
        if (cmp.delta !== undefined) brk.delta = cmp.delta;
        breaks.push(brk);
        byType.value_mismatch++;
      }
    }
  }

  for (const key of tgt.map.keys()) {
    if (!src.map.has(key)) {
      breaks.push({ key, type: "missing_in_source", severity: "high" });
      byType.missing_in_source++;
    }
  }

  const summary: ReconSummary = {
    sourceSystem: config.sourceSystem ?? "source",
    targetSystem: config.targetSystem ?? "target",
    sourceCount: source.length,
    targetCount: target.length,
    matchedKeys,
    breakCount: breaks.length,
    byType,
    balanced: breaks.length === 0,
  };

  return { summary, breaks };
}

// ── Exception workflow (CAP-059) ────────────────────────────────────────────

export type ExceptionStatus = "open" | "investigating" | "resolved" | "written_off";
export type ExceptionAction = "investigate" | "resolve" | "write_off" | "reopen";

export class ExceptionWorkflowError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ExceptionWorkflowError";
  }
}

const TRANSITIONS: Record<ExceptionStatus, Partial<Record<ExceptionAction, ExceptionStatus>>> = {
  open: { investigate: "investigating", resolve: "resolved", write_off: "written_off" },
  investigating: { resolve: "resolved", write_off: "written_off" },
  resolved: { reopen: "open" },
  written_off: { reopen: "open" },
};

/** Terminal states for an exception — no further work is expected. */
export function isTerminalException(status: ExceptionStatus): boolean {
  return status === "resolved" || status === "written_off";
}

/** Apply an action to an exception, returning the next status or throwing. */
export function applyExceptionAction(current: ExceptionStatus, action: ExceptionAction): ExceptionStatus {
  const next = TRANSITIONS[current][action];
  if (!next) {
    throw new ExceptionWorkflowError(
      "INVALID_TRANSITION",
      `cannot ${action} an exception in status ${current}`,
    );
  }
  return next;
}
