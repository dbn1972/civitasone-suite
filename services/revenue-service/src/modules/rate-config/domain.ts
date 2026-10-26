/**
 * Rate-config domain — pure planning for maker-checker, versioned,
 * effective-dated rate configuration (owner decision #2, 2026-10-26,
 * GAP-REVENUE-CONFIG-01).
 *
 * A proposal NEVER changes a row in place:
 *   create    inserts a new row (version 1)
 *   revise    end-dates the live row at the effective date and inserts the NEXT
 *             VERSION effective from that date
 *   end_date  sets effective_to (deactivation is an end-date)
 *
 * `planProposal` returns the writes as data (PlanOp[]). The consumer executes
 * them in the approval transaction; `previewProposal` applies them to an
 * in-memory copy and re-runs the real rate engine so the approver sees the
 * effect on a computed demand BEFORE approving. Both share one code path, so
 * what is previewed is what is applied.
 */
import { randomUUID } from "node:crypto";
import {
  DomainError,
  assertNoSlabOverlap,
  compute,
  type RateSlab,
  type PenaltyRule,
  type RebateRule,
  type SlabWindow,
} from "../rate-engine/domain.js";

export type ConfigKind = "rate_head" | "rate_slab" | "penalty_rule" | "rebate_rule";
export type ConfigAction = "create" | "revise" | "end_date";

export interface Proposal {
  id: string;
  kind: ConfigKind;
  action: ConfigAction;
  targetId: string | null;
  rateHeadId: string | null;
  /** YYYY-MM-DD the change takes effect (never in the past). */
  effectiveFrom: string;
  payload: Record<string, unknown>;
}

export interface HeadState {
  id: string; code: string; name: string; category: string; unitOfMeasure: string | null;
  isActive: boolean; effectiveTo: string | null; version: number;
}
export type SlabState = RateSlab & { version: number };
export type PenaltyState = PenaltyRule & { effectiveFrom: string; effectiveTo: string | null; version: number };
export type RebateState = RebateRule & { effectiveFrom: string; effectiveTo: string | null; version: number };

export interface ConfigState {
  heads: HeadState[];
  slabs: SlabState[];
  penalties: PenaltyState[];
  rebates: RebateState[];
}

export type PlanTable = "rate_heads" | "rate_slabs" | "penalty_rules" | "rebate_rules";
export interface PlanOp {
  op: "insert" | "update";
  table: PlanTable;
  id?: string;
  values: Record<string, unknown>;
}

const TABLE_OF: Record<ConfigKind, PlanTable> = {
  rate_head: "rate_heads",
  rate_slab: "rate_slabs",
  penalty_rule: "penalty_rules",
  rebate_rule: "rebate_rules",
};

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const big = (v: unknown): bigint | null => (v === undefined || v === null ? null : BigInt(v as string | number | bigint));

/** Closing a row at `date`: also deactivates it when that date has already arrived. */
function endValues(date: string, today: string): Record<string, unknown> {
  return date <= today ? { effectiveTo: date, isActive: false } : { effectiveTo: date };
}

function requireTarget<T extends { id: string }>(rows: T[], id: string | null, what: string): T {
  const row = id ? rows.find((r) => r.id === id) : undefined;
  if (!row) throw new DomainError("TARGET_NOT_FOUND", `${what} not found`);
  return row;
}

function requireHead(state: ConfigState, rateHeadId: string | null | undefined): string {
  if (!rateHeadId || !state.heads.some((h) => h.id === rateHeadId)) {
    throw new DomainError("RATE_HEAD_NOT_FOUND", "rate head not found");
  }
  return rateHeadId;
}

/** A rule window [from, to) of an existing row is live at/after `date` if it has not ended by then. */
function ruleLiveFrom(row: { isActive: boolean; effectiveTo: string | null }, date: string): boolean {
  return row.isActive && (row.effectiveTo === null || row.effectiveTo > date);
}

export function planProposal(state: ConfigState, p: Proposal, today: string): PlanOp[] {
  if (p.effectiveFrom < today) {
    throw new DomainError("EFFECTIVE_DATE_IN_PAST", "Rate configuration changes cannot be effective in the past");
  }
  const table = TABLE_OF[p.kind];
  const d = p.effectiveFrom;

  // ── end_date: deactivation is an end-date ──────────────────────────────────
  if (p.action === "end_date") {
    const rows: Array<{ id: string; effectiveFrom?: string; effectiveTo: string | null }> =
      p.kind === "rate_head" ? state.heads
      : p.kind === "rate_slab" ? state.slabs
      : p.kind === "penalty_rule" ? state.penalties
      : state.rebates;
    const row = requireTarget(rows, p.targetId, "target");
    if (row.effectiveFrom && d <= row.effectiveFrom) {
      throw new DomainError("EFFECTIVE_DATE_BEFORE_START", "The end date must be after the row's own start date");
    }
    if (row.effectiveTo && d >= row.effectiveTo) {
      throw new DomainError("ALREADY_ENDED", "This row already ends on or before that date");
    }
    return [{ op: "update", table, id: row.id, values: endValues(d, today) }];
  }

  // ── rate_head ──────────────────────────────────────────────────────────────
  if (p.kind === "rate_head") {
    if (p.action === "revise") {
      throw new DomainError("UNSUPPORTED_ACTION", "A rate head is an identity: end-date it and create a new one instead of editing it");
    }
    return [{
      op: "insert", table,
      values: {
        code: str(p.payload.code), name: str(p.payload.name), category: str(p.payload.category),
        unitOfMeasure: str(p.payload.unitOfMeasure) ?? null, isActive: true, effectiveTo: null, version: 1,
      },
    }];
  }

  // ── rate_slab ──────────────────────────────────────────────────────────────
  if (p.kind === "rate_slab") {
    const windows = (rows: SlabState[]): SlabWindow[] => rows.map((s) => ({
      slabType: s.slabType, bandFrom: s.bandFrom, bandTo: s.bandTo, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, isActive: s.isActive,
    }));
    if (p.action === "create") {
      const headId = requireHead(state, str(p.payload.rateHeadId) ?? p.rateHeadId);
      const cand = {
        rateHeadId: headId, slabType: str(p.payload.slabType)!, bandFrom: big(p.payload.bandFrom), bandTo: big(p.payload.bandTo),
        rateValue: big(p.payload.rateValue)!, effectiveFrom: d, effectiveTo: str(p.payload.effectiveTo) ?? null,
      };
      assertNoSlabOverlap(windows(state.slabs.filter((s) => s.rateHeadId === headId)), { ...cand, isActive: true });
      return [{ op: "insert", table, values: { ...cand, unitOfMeasure: null, isActive: true, version: 1 } }];
    }
    const old = requireTarget(state.slabs, p.targetId, "slab");
    if (d <= old.effectiveFrom) throw new DomainError("EFFECTIVE_DATE_BEFORE_START", "The new version must start after the slab it replaces");
    if (old.effectiveTo !== null && old.effectiveTo <= d) throw new DomainError("ALREADY_ENDED", "That slab has already ended");
    const next = {
      rateHeadId: old.rateHeadId,
      slabType: str(p.payload.slabType) ?? old.slabType,
      bandFrom: "bandFrom" in p.payload ? big(p.payload.bandFrom) : old.bandFrom,
      bandTo: "bandTo" in p.payload ? big(p.payload.bandTo) : old.bandTo,
      rateValue: "rateValue" in p.payload ? big(p.payload.rateValue)! : old.rateValue,
      effectiveFrom: d, effectiveTo: old.effectiveTo,
    };
    const others = state.slabs.filter((s) => s.rateHeadId === old.rateHeadId && s.id !== old.id);
    assertNoSlabOverlap(windows(others), { ...next, isActive: true });
    return [
      { op: "update", table, id: old.id, values: endValues(d, today) },
      { op: "insert", table, values: { ...next, unitOfMeasure: null, isActive: true, version: old.version + 1 } },
    ];
  }

  // ── penalty_rule / rebate_rule ─────────────────────────────────────────────
  const rows = (p.kind === "penalty_rule" ? state.penalties : state.rebates) as Array<PenaltyState | RebateState>;
  const fields = (src: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> => {
    if (p.kind === "penalty_rule") {
      const pick = (k: string) => (k in src ? src[k] : base[k]);
      return {
        interestType: pick("interestType"), annualRateBps: pick("annualRateBps"), graceDays: pick("graceDays") ?? 0,
        capMonths: pick("capMonths") ?? null, roundingMode: pick("roundingMode") ?? "round_half_up",
      };
    }
    const pick = (k: string) => (k in src ? src[k] : base[k]);
    return { rebateType: pick("rebateType"), discountBps: pick("discountBps"), validUntilDaysBeforeDue: pick("validUntilDaysBeforeDue") ?? null };
  };

  if (p.action === "create") {
    const headId = requireHead(state, str(p.payload.rateHeadId) ?? p.rateHeadId);
    if (rows.some((r) => r.rateHeadId === headId && ruleLiveFrom(r, d))) {
      throw new DomainError("RULE_OVERLAP", `A ${p.kind === "penalty_rule" ? "penalty" : "rebate"} rule is already live for this rate head; revise it to create a new version`);
    }
    return [{ op: "insert", table, values: { rateHeadId: headId, ...fields(p.payload, {}), effectiveFrom: d, effectiveTo: null, isActive: true, version: 1 } }];
  }

  const old = requireTarget(rows, p.targetId, "rule");
  if (d <= old.effectiveFrom) throw new DomainError("EFFECTIVE_DATE_BEFORE_START", "The new version must start after the rule it replaces");
  if (old.effectiveTo !== null && old.effectiveTo <= d) throw new DomainError("ALREADY_ENDED", "That rule has already ended");
  return [
    { op: "update", table, id: old.id, values: endValues(d, today) },
    {
      op: "insert", table,
      values: { rateHeadId: old.rateHeadId, ...fields(p.payload, old as unknown as Record<string, unknown>), effectiveFrom: d, effectiveTo: old.effectiveTo, isActive: true, version: old.version + 1 },
    },
  ];
}

/** Apply planned writes to an in-memory copy of the state (preview). */
export function applyOpsToState(state: ConfigState, ops: PlanOp[]): ConfigState {
  const next: ConfigState = {
    heads: state.heads.map((x) => ({ ...x })), slabs: state.slabs.map((x) => ({ ...x })),
    penalties: state.penalties.map((x) => ({ ...x })), rebates: state.rebates.map((x) => ({ ...x })),
  };
  const bucket = (t: PlanTable): Array<Record<string, unknown>> =>
    (t === "rate_heads" ? next.heads : t === "rate_slabs" ? next.slabs : t === "penalty_rules" ? next.penalties : next.rebates) as unknown as Array<Record<string, unknown>>;
  for (const o of ops) {
    const rows = bucket(o.table);
    if (o.op === "insert") rows.push({ id: randomUUID(), ...o.values });
    else {
      const row = rows.find((r) => r.id === o.id);
      if (row) Object.assign(row, o.values);
    }
  }
  return next;
}

export interface SampleResult {
  principal: string; rebate: string; penalty: string; interest: string; net: string; error?: string;
}
export interface ProposalPreview {
  /** Set when the proposal cannot be applied as it stands (shown instead of a broken preview). */
  blocked: string | null;
  changes: PlanOp[];
  /** A computed sample demand before vs after, or null when no rate is changing (rate heads). */
  sample: { asOfDate: string; dueDate: string; baseValue: string; before: SampleResult; after: SampleResult } | null;
}

function addDays(date: string, days: number): string {
  const x = new Date(`${date}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

function sampleCompute(state: ConfigState, rateHeadId: string, asOfDate: string, dueDate: string, baseValue: bigint): SampleResult {
  try {
    const r = compute(state.slabs, state.penalties, state.rebates, { rateHeadId, baseValue, asOfDate, dueDate, exemptions: [] });
    return { principal: r.principal.toString(), rebate: r.rebate.toString(), penalty: r.penalty.toString(), interest: r.interest.toString(), net: r.net.toString() };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { principal: "0", rebate: "0", penalty: "0", interest: "0", net: "0", error: err.code };
  }
}

export function previewProposal(
  state: ConfigState,
  p: Proposal,
  opts: { today: string; baseValue: bigint },
): ProposalPreview {
  let ops: PlanOp[];
  try {
    ops = planProposal(state, p, opts.today);
  } catch (err) {
    if (err instanceof DomainError) return { blocked: err.message, changes: [], sample: null };
    throw err;
  }
  if (p.kind === "rate_head") return { blocked: null, changes: ops, sample: null };

  const target = p.targetId
    ? [...state.slabs, ...state.penalties, ...state.rebates].find((r) => r.id === p.targetId)
    : undefined;
  const headId = p.rateHeadId ?? (str(p.payload.rateHeadId) ?? target?.rateHeadId ?? null);
  if (!headId) return { blocked: null, changes: ops, sample: null };

  // Sample an OVERDUE demand (90 days past due) so a penalty/interest change shows too.
  const asOfDate = p.effectiveFrom > opts.today ? p.effectiveFrom : opts.today;
  const dueDate = addDays(asOfDate, -90);
  const after = applyOpsToState(state, ops);
  return {
    blocked: null,
    changes: ops,
    sample: {
      asOfDate, dueDate, baseValue: opts.baseValue.toString(),
      before: sampleCompute(state, headId, asOfDate, dueDate, opts.baseValue),
      after: sampleCompute(after, headId, asOfDate, dueDate, opts.baseValue),
    },
  };
}
