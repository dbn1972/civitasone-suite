/**
 * WC-009 — pure domain logic for sandbox masked refresh.
 *
 * The single most important rule here: MASKING IS THE DEFAULT. A field with no
 * masking rule is treated as sensitive and gets `redact`. Passing a field
 * through in the clear requires an explicit `preserve` rule WITH a written
 * justification — you cannot leak a column by forgetting to configure it.
 *
 * Nothing in this file touches a database, a queue, or a log. It also never
 * accepts or returns a field VALUE, only field names — so it is structurally
 * incapable of logging the data it masks.
 */
import { HttpError } from "../../shared/context.js";

export const SOURCE_ENVIRONMENTS = ["dev", "staging", "uat", "production"] as const;
export type SourceEnvironment = (typeof SOURCE_ENVIRONMENTS)[number];

export const MASKING_STRATEGIES = ["redact", "hash", "partial", "nullify", "preserve"] as const;
export type MaskingStrategy = (typeof MASKING_STRATEGIES)[number];

/** The fail-closed strategy applied to any field without an explicit rule. */
export const DEFAULT_STRATEGY: MaskingStrategy = "redact";

export const SANDBOX_STATUSES = ["registered", "refreshing", "ready", "disabled"] as const;
export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const REFRESH_STATUSES = [
  "pending_approval", "rejected", "queued", "running", "completed", "failed",
] as const;
export type RefreshStatus = (typeof REFRESH_STATUSES)[number];

export interface FieldRef {
  tableName: string;
  fieldName: string;
}

export interface MaskingRule extends FieldRef {
  strategy: MaskingStrategy;
  justification: string;
}

export interface PlannedField extends FieldRef {
  strategy: MaskingStrategy;
  /** `rule` when an explicit rule matched, `default` when fail-closed applied. */
  ruleSource: "rule" | "default";
  /** False only for an explicit `preserve` rule. */
  masked: boolean;
}

export interface MaskingPlan {
  fields: PlannedField[];
  maskedFieldCount: number;
  preservedFieldCount: number;
  /** Fields that got the fail-closed default because nobody configured them. */
  defaultedFields: FieldRef[];
}

function keyOf(ref: FieldRef): string {
  return `${ref.tableName.toLowerCase()}.${ref.fieldName.toLowerCase()}`;
}

/**
 * Resolve the strategy for one field. Returns the fail-closed default when no
 * rule matches — this is the behaviour the "no rule means masked" test pins.
 */
export function resolveStrategy(
  field: FieldRef,
  rules: readonly MaskingRule[],
): { strategy: MaskingStrategy; ruleSource: "rule" | "default" } {
  const match = rules.find((r) => keyOf(r) === keyOf(field));
  if (!match) return { strategy: DEFAULT_STRATEGY, ruleSource: "default" };
  return { strategy: match.strategy, ruleSource: "rule" };
}

/** True when the strategy actually obscures the value. Only `preserve` does not. */
export function isMasking(strategy: MaskingStrategy): boolean {
  return strategy !== "preserve";
}

/**
 * Build the full plan for a refresh: one entry per requested field, each with
 * its resolved strategy and where that strategy came from.
 */
export function buildMaskingPlan(
  requestedFields: readonly FieldRef[],
  rules: readonly MaskingRule[],
): MaskingPlan {
  const seen = new Set<string>();
  const fields: PlannedField[] = [];
  const defaultedFields: FieldRef[] = [];

  for (const field of requestedFields) {
    const key = keyOf(field);
    if (seen.has(key)) continue; // a duplicate request is planned once
    seen.add(key);
    const { strategy, ruleSource } = resolveStrategy(field, rules);
    if (ruleSource === "default") defaultedFields.push({ tableName: field.tableName, fieldName: field.fieldName });
    fields.push({
      tableName: field.tableName,
      fieldName: field.fieldName,
      strategy,
      ruleSource,
      masked: isMasking(strategy),
    });
  }

  return {
    fields,
    maskedFieldCount: fields.filter((f) => f.masked).length,
    preservedFieldCount: fields.filter((f) => !f.masked).length,
    defaultedFields,
  };
}

// ── guards ──────────────────────────────────────────────────────────────────

/**
 * `preserve` is a deliberate decision to copy a column in the clear, so it must
 * carry a written justification that a reviewer can read later.
 */
export function assertPreserveJustified(strategy: MaskingStrategy, justification: string): void {
  if (strategy === "preserve" && justification.trim().length < 10) {
    throw new HttpError(
      422,
      "PRESERVE_NEEDS_JUSTIFICATION",
      "a 'preserve' masking rule passes data through unmasked and requires a justification of at least 10 characters",
    );
  }
}

/**
 * Maker-checker: a sandbox refresh reads from a source environment (potentially
 * production), so the actor who requested it can never be the one who approves it.
 */
export function assertApproverDistinct(requestedBy: string, approverId: string): void {
  if (requestedBy === approverId) {
    throw new HttpError(
      409,
      "MAKER_CHECKER_VIOLATION",
      "the approver of a sandbox refresh must differ from the requester",
    );
  }
}

/** Only a request still awaiting approval can be approved or rejected. */
export function assertAwaitingApproval(status: string): void {
  if (status !== "pending_approval") {
    throw new HttpError(
      409,
      "NOT_PENDING_APPROVAL",
      `refresh job is '${status}', only 'pending_approval' jobs can be decided`,
    );
  }
}

/** Optimistic lock check — see config/artefact-domain.ts for the same guard. */
export function assertVersionMatch(current: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (current !== expected) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      `version conflict: expected ${expected}, current is ${current}`,
    );
  }
}

/** A disabled sandbox cannot be refreshed. */
export function assertSandboxRefreshable(status: string): void {
  if (status === "disabled") {
    throw new HttpError(422, "SANDBOX_DISABLED", "a disabled sandbox cannot be refreshed");
  }
  if (status === "refreshing") {
    throw new HttpError(409, "REFRESH_IN_PROGRESS", "a refresh is already in progress for this sandbox");
  }
}
