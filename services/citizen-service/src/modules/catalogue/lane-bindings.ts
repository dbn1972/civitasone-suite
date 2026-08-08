/**
 * FN-25 / FN-26 — pack-level lane SLA/escalation + document verification bindings
 * (pure domain helpers, no I/O).
 *
 * Designers author per-lane SLA days and an escalation designation (superior).
 * Required documents carry verifiedAtLane so officers see a lane-scoped checklist
 * at runtime. Sandbox simulates an SLA breach → escalation notification.
 */

export interface LaneBinding {
  key: string;
  name: string;
  optional?: boolean;
  enabled?: boolean;
  designationId?: string;
  designationLabel?: string;
  slaDays: number;
  escalationDesignationId?: string;
  escalationDesignationLabel?: string;
}

export interface RequiredDocWithLane {
  docType: string;
  label?: string | undefined;
  mandatory: boolean;
  verifiedAtLane?: string | undefined;
}

/** Convert designer SLA days to workflow engine minutes (24h calendar days). */
export function slaDaysToMinutes(slaDays: number): number | null {
  if (!Number.isFinite(slaDays) || slaDays <= 0) return null;
  return Math.round(slaDays * 24 * 60);
}

/** Absolute due timestamp for a lane SLA clock starting at `from`. */
export function computeLaneDueAt(slaDays: number, from: Date = new Date()): Date | null {
  const minutes = slaDaysToMinutes(slaDays);
  if (minutes == null) return null;
  return new Date(from.getTime() + minutes * 60_000);
}

/**
 * Resolve the escalation recipient for a breached lane.
 * Prefer the superior designation; fall back to the acting designation; else null.
 */
export function resolveEscalationRecipient(lane: Pick<
  LaneBinding,
  "escalationDesignationId" | "designationId"
>): string | null {
  const superior = lane.escalationDesignationId?.trim();
  if (superior) return superior;
  const actor = lane.designationId?.trim();
  return actor || null;
}

/** True when a lane is actionable for SLA (enabled, has positive SLA days). */
export function isSlaTrackedLane(lane: LaneBinding): boolean {
  return lane.enabled !== false && lane.slaDays > 0 && lane.key !== "submitted" && lane.key !== "issued";
}

/**
 * FN-25 sandbox acceptance helper — simulate a breached lane and the escalation
 * notification that would fire. Pure: no queue I/O; returns the payload that
 * sandbox surfaces as an artifact.
 */
export function simulateLaneSlaBreach(
  lane: LaneBinding,
  now: Date = new Date(),
): {
  breached: boolean;
  laneKey: string;
  dueAt: string | null;
  recipient: string | null;
  notification: {
    eventType: "workflow.task.escalated";
    summary: string;
    escalateTo: string | null;
    escalateToLabel: string | null;
  } | null;
} {
  if (!isSlaTrackedLane(lane)) {
    return { breached: false, laneKey: lane.key, dueAt: null, recipient: null, notification: null };
  }
  // Simulate breach: clock started more than slaDays ago.
  const started = new Date(now.getTime() - (lane.slaDays + 1) * 24 * 60 * 60 * 1000);
  const dueAt = computeLaneDueAt(lane.slaDays, started);
  const recipient = resolveEscalationRecipient(lane);
  const escalateLabel = lane.escalationDesignationLabel?.trim()
    || lane.designationLabel?.trim()
    || null;
  return {
    breached: true,
    laneKey: lane.key,
    dueAt: dueAt?.toISOString() ?? null,
    recipient,
    notification: {
      eventType: "workflow.task.escalated",
      summary: `SLA breached — lane overdue: ${lane.name}`,
      escalateTo: recipient,
      escalateToLabel: escalateLabel,
    },
  };
}

/**
 * FN-26 — documents that must be verified at a given workflow lane.
 * Normalizes `lane_inspection` / `lane.inspection` / `Inspection` → `inspection`.
 */
export function normalizeLaneKey(laneKey: string): string {
  const raw = laneKey.trim().toLowerCase();
  const stripped = raw.replace(/^lane[_./-]?/, "").replace(/\s+/g, "_");
  return stripped;
}

/** Filter required documents bound to the given verification lane. */
export function docsForVerificationLane(
  docs: RequiredDocWithLane[],
  laneKey: string,
): RequiredDocWithLane[] {
  const target = normalizeLaneKey(laneKey);
  if (!target) return [];
  return docs.filter((d) => d.verifiedAtLane && normalizeLaneKey(d.verifiedAtLane) === target);
}

/** Mandatory docs for a lane that still lack a verifying-lane binding (designer warning). */
export function unboundMandatoryDocs(docs: RequiredDocWithLane[]): RequiredDocWithLane[] {
  return docs.filter((d) => d.mandatory && !d.verifiedAtLane?.trim());
}

/** Validate lane binding shape before persist. */
export function assertLaneBindings(bindings: LaneBinding[]): void {
  const seen = new Set<string>();
  for (const b of bindings) {
    if (!b.key?.trim()) throw new Error("LANE_MISSING_KEY");
    if (seen.has(b.key)) throw new Error(`LANE_DUPLICATE_KEY: ${b.key}`);
    seen.add(b.key);
    if (!Number.isFinite(b.slaDays) || b.slaDays < 0 || b.slaDays > 3650) {
      throw new Error(`LANE_BAD_SLA: ${b.key}`);
    }
  }
}
