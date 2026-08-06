/**
 * Pure checklist lifecycle logic for CRM (G7).
 *
 * All scoring / visibility / prerequisite / completion mathematics lives in
 * @civitasone/checklist and is NOT reimplemented here — an equivalent engine already
 * exists in inspection-service, and a third copy is exactly what the shared package
 * exists to prevent. What lives here is the part that is CRM's own: the two status
 * machines and the rules about when a template may be amended, published or
 * instantiated.
 */
import {
  evaluateCompletion,
  freezeStructure,
  mergeResponses,
  validateStructure,
  type ChecklistResponses,
  type ChecklistSection,
  type CompletionState,
} from "@civitasone/checklist";
import {
  INSTANCE_STATUSES,
  TEMPLATE_STATUSES,
  SUBJECT_TYPES,
  type InstanceStatus,
  type TemplateStatus,
  type ChecklistSubjectType,
} from "./schema.js";

export {
  INSTANCE_STATUSES,
  TEMPLATE_STATUSES,
  SUBJECT_TYPES,
  type InstanceStatus,
  type TemplateStatus,
  type ChecklistSubjectType,
};

/**
 * Template lifecycle: draft → published → deprecated.
 *
 * `deprecated` is terminal, and there is no path back to `draft`. Re-opening a
 * published template for editing is the one thing this design forbids outright:
 * instances hold a copy of its structure, and an auditor asking "what was this
 * customer asked in March" must get an answer that cannot have been edited since.
 * Changing a published checklist means publishing a new version.
 */
const TEMPLATE_TRANSITIONS: Readonly<Record<TemplateStatus, readonly TemplateStatus[]>> = {
  draft: ["published", "deprecated"],
  published: ["deprecated"],
  deprecated: [],
};

/**
 * Instance lifecycle. `completed` is terminal because a completed checklist is a
 * record of what was answered and when; further answers belong to a new instance.
 * `cancelled` is terminal for the same reason.
 */
const INSTANCE_TRANSITIONS: Readonly<Record<InstanceStatus, readonly InstanceStatus[]>> = {
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isTemplateStatus(value: string): value is TemplateStatus {
  return (TEMPLATE_STATUSES as readonly string[]).includes(value);
}

export function isInstanceStatus(value: string): value is InstanceStatus {
  return (INSTANCE_STATUSES as readonly string[]).includes(value);
}

export function isSubjectType(value: string): value is ChecklistSubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(value);
}

export function allowedNextTemplateStatuses(status: TemplateStatus): readonly TemplateStatus[] {
  return TEMPLATE_TRANSITIONS[status];
}

export function canTemplateTransition(from: TemplateStatus, to: TemplateStatus): boolean {
  return TEMPLATE_TRANSITIONS[from].includes(to);
}

export function allowedNextInstanceStatuses(status: InstanceStatus): readonly InstanceStatus[] {
  return INSTANCE_TRANSITIONS[status];
}

export function canInstanceTransition(from: InstanceStatus, to: InstanceStatus): boolean {
  return INSTANCE_TRANSITIONS[from].includes(to);
}

/** Only a draft may be structurally amended. See TEMPLATE_TRANSITIONS for why. */
export function isTemplateEditable(status: TemplateStatus): boolean {
  return status === "draft";
}

/** Only a published template may be instantiated: a draft is not yet in force. */
export function isTemplateInstantiable(status: TemplateStatus): boolean {
  return status === "published";
}

/** A published template must have at least one section with at least one question. */
export function isPublishable(sections: readonly ChecklistSection[]): boolean {
  return sections.length > 0 && sections.some((s) => s.questions.length > 0);
}

/** The version number a new draft of `templateKey` should take. */
export function nextVersionNumber(highestExisting: number | null): number {
  return (highestExisting ?? 0) + 1;
}

/**
 * Validate an authored structure. Delegates entirely to the shared engine so CRM and
 * inspection cannot drift on what a legal template is.
 */
export function assertValidStructure(sections: readonly ChecklistSection[]): true {
  return validateStructure(sections);
}

/** The frozen copy an instance is created with. */
export function buildInstanceStructure(sections: readonly ChecklistSection[]): ChecklistSection[] {
  return freezeStructure(sections);
}

/** Apply a partial submission to what is already recorded. */
export function applyResponses(
  existing: ChecklistResponses,
  incoming: ChecklistResponses,
): ChecklistResponses {
  return mergeResponses(existing, incoming);
}

/** Progress, outstanding required items and score — straight from the shared engine. */
export function completionOf(
  structure: readonly ChecklistSection[],
  responses: ChecklistResponses,
): CompletionState {
  return evaluateCompletion(structure, responses);
}

/**
 * The status an instance should hold after a submission.
 *
 * Completion is derived, never asserted by the caller: an instance is complete exactly
 * when nothing required, visible and unlocked is outstanding. A caller cannot declare
 * a half-finished checklist done, and does not need to remember to declare a finished
 * one done either.
 */
export function statusAfterSubmission(
  current: InstanceStatus,
  completion: CompletionState,
): InstanceStatus {
  if (current !== "in_progress") return current;
  return completion.complete ? "completed" : "in_progress";
}

/** True when a submission moves the instance from in-flight to completed. */
export function completesInstance(
  current: InstanceStatus,
  completion: CompletionState,
): boolean {
  return current === "in_progress" && completion.complete;
}
