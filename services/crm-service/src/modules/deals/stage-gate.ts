/**
 * Pure stage-gate evaluation (OP-002 / OP-003).
 *
 * A pipeline stage may declare `mandatoryFields` — opportunity field names that must be
 * populated before a deal is allowed to ENTER that stage. The stage-change route calls
 * {@link missingMandatoryFields} synchronously and refuses the progression (422
 * MANDATORY_STAGE_FIELDS_MISSING) when anything is missing, so an incomplete opportunity
 * can never advance. No I/O here — the caller supplies the deal snapshot and the stage.
 */

export interface PipelineStageLike {
  id: string;
  name: string;
  ordinal: number;
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
