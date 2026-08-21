/**
 * Pure stage-gate evaluation (OP-002 / OP-003).
 *
 * A pipeline stage may declare `mandatoryFields` — opportunity field names that must be
 * populated before a deal is allowed to ENTER that stage. The stage-change route calls
 * {@link missingMandatoryFields} synchronously and refuses the progression (422
 * MANDATORY_STAGE_FIELDS_MISSING) when anything is missing, so an incomplete opportunity
 * can never advance.
 *
 * A stage may also declare `gate: true` — it cannot be skipped OVER by a forward PATCH.
 * {@link skippedGateStage} evaluates that rule (422 GATED_STAGE_SKIPPED when violated),
 * and {@link deriveStageFields} is the single source of truth for the status/probability/
 * closed-state a deal must carry once it enters a given stage, used by every code path
 * that changes a deal's stage so that value can never drift stale (e.g. a deal moved off
 * Won keeping a Won-era probability/closed_at). No I/O here — the caller supplies the
 * deal snapshot and the pipeline's stage list.
 */

export interface PipelineStageLike {
  id: string;
  name: string;
  ordinal: number;
  /** The stage's own default probability (0–100). Optional only so hand-built test
   *  fixtures that don't exercise deriveStageFields need not supply it. */
  probability?: number | undefined;
  mandatoryFields?: string[] | undefined;
  gate?: boolean | undefined;
}

/**
 * A deal reduced to the fields a gate can reference. Values are as loaded from the row;
 * emptiness is decided by {@link isPresent}.
 */
export interface DealFieldSnapshot {
  product?: string | null;
  quantity?: number | null;
  competitors?: unknown[] | null;
  nextStep?: string | null;
  expectedCloseDate?: string | null;
  closeDate?: string | null;
  valueMinor?: string | bigint | number | null;
  contactId?: string | null;
  ownerId?: string | null;
  name?: string | null;
  currency?: string | null;
}

/** Canonical field-name aliases so a stage config may use snake_case or camelCase. */
const FIELD_ALIASES: Record<string, keyof DealFieldSnapshot> = {
  product: "product",
  quantity: "quantity",
  competitors: "competitors",
  next_step: "nextStep",
  nextstep: "nextStep",
  nextStep: "nextStep",
  expected_close_date: "expectedCloseDate",
  expectedclosedate: "expectedCloseDate",
  expectedCloseDate: "expectedCloseDate",
  close_date: "closeDate",
  closedate: "closeDate",
  closeDate: "closeDate",
  value: "valueMinor",
  value_minor: "valueMinor",
  valueminor: "valueMinor",
  valueMinor: "valueMinor",
  contact: "contactId",
  contact_id: "contactId",
  contactId: "contactId",
  owner: "ownerId",
  owner_id: "ownerId",
  ownerId: "ownerId",
  name: "name",
  currency: "currency",
};

/** A field is present when it holds a meaningful, non-empty value. */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value > 0;
  if (typeof value === "bigint") return value > 0n;
  return true;
}

/**
 * Returns the mandatory field names (as declared on the stage) that are NOT populated on
 * the deal snapshot. Empty array = the deal satisfies the gate. Unknown field names are
 * reported as missing so a typo in config fails safe (loud) rather than silently passing.
 */
export function missingMandatoryFields(
  snapshot: DealFieldSnapshot,
  stage: PipelineStageLike | undefined,
): string[] {
  const required = stage?.mandatoryFields ?? [];
  const missing: string[] = [];
  for (const raw of required) {
    const key = FIELD_ALIASES[raw] ?? FIELD_ALIASES[raw.toLowerCase()];
    if (!key) {
      missing.push(raw);
      continue;
    }
    if (!isPresent(snapshot[key])) missing.push(raw);
  }
  return missing;
}

/** Find the target stage in a pipeline's stage list by id first, then by name. */
export function findStage(
  stages: readonly PipelineStageLike[] | null | undefined,
  opts: { stageId?: string | undefined; stageName?: string | undefined },
): PipelineStageLike | undefined {
  if (!stages) return undefined;
  if (opts.stageId) {
    const byId = stages.find((s) => s.id === opts.stageId);
    if (byId) return byId;
  }
  if (opts.stageName) {
    return stages.find((s) => s.name === opts.stageName);
  }
  return undefined;
}

/**
 * Returns the (lowest-ordinal) gated stage that a FORWARD move from `current` to
 * `target` would skip over, or undefined when the move doesn't skip anything gated.
 * `gate: true` means a stage cannot be skipped OVER — it says nothing about whether the
 * stage itself may be entered directly, so only stages strictly between the two ordinals
 * are considered.
 *
 * Backward and lateral moves (target ordinal <= current ordinal) are never treated as a
 * skip: real-world CRM usage commonly reopens a deal by moving it back a stage, and that
 * is not the "cannot skip ahead" rule the `gate` flag exists to enforce.
 */
export function skippedGateStage(
  stages: readonly PipelineStageLike[] | null | undefined,
  current: PipelineStageLike | undefined,
  target: PipelineStageLike | undefined,
): PipelineStageLike | undefined {
  if (!stages || !current || !target) return undefined;
  if (target.ordinal <= current.ordinal) return undefined;
  const skipped = stages.filter((s) => s.gate === true && s.ordinal > current.ordinal && s.ordinal < target.ordinal);
  if (skipped.length === 0) return undefined;
  return skipped.reduce((min, s) => (s.ordinal < min.ordinal ? s : min), skipped[0]!);
}

/** The status/probability/closed-state a deal must carry after entering a stage. */
export interface DerivedStageFields {
  status: string;
  probability: number;
  /** true => Won/Lost: the write stamps closed_at = now(). false => closed_at is cleared. */
  closesDeal: boolean;
}

/**
 * Single source of truth for the status/probability/closed_at a deal must carry once it
 * enters `targetStageName`. Call this from every code path that changes a deal's stage —
 * a forward walk, a backward/reopen move, or a deal with no pipeline configured at all —
 * rather than special-casing "the backward case" and "the forward case" separately,
 * which is how a stale-field bug like this tends to come back.
 *
 * Won/Lost always resolve to their fixed status + probability (100/0) and close the
 * deal, regardless of any caller-supplied probability — matching the existing, working
 * forward-path contract. Every other stage is always active/open: an explicit
 * `requestedProbability` is honoured if supplied, otherwise the TARGET stage's own
 * configured default probability is used — never the deal's previous (potentially
 * stale, e.g. Won-era) probability.
 */
export function deriveStageFields(
  targetStageName: string,
  target: PipelineStageLike | undefined,
  requestedProbability?: number,
): DerivedStageFields {
  if (targetStageName === "Won") return { status: "won", probability: 100, closesDeal: true };
  if (targetStageName === "Lost") return { status: "lost", probability: 0, closesDeal: true };
  return { status: "active", probability: requestedProbability ?? target?.probability ?? 0, closesDeal: false };
}
