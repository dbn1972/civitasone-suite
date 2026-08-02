/**
 * events/taxonomy-version-domain.ts — CR-CDP-03 versioned event schema lifecycle (PURE).
 *
 * Extends the CDP-004 registry (taxonomy-domain.ts) rather than replacing it: the field
 * grammar and payload validator are imported from there, and this file adds only what
 * versioning needs — which revision is in force, what changing a schema breaks, and which
 * lifecycle moves are legal.
 *
 * Lifecycle is per revision, not per event name:
 *   draft      — being authored, not usable for validation
 *   active     — the contract in force; exactly one per event name
 *   deprecated — retired; kept so historical events remain explicable
 */
import { validatePayload, type PayloadViolation } from "./taxonomy-domain.js";

export const VERSION_STATUSES = ["draft", "active", "deprecated"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** Activation is not reversible and deprecation is terminal: history stays honest. */
const VERSION_TRANSITIONS: Record<VersionStatus, readonly VersionStatus[]> = {
  draft: ["draft", "active", "deprecated"],
  active: ["active", "deprecated"],
  deprecated: ["deprecated"],
};

export function canTransitionVersion(from: string, to: VersionStatus): boolean {
  const allowed = VERSION_TRANSITIONS[from as VersionStatus];
  return allowed !== undefined && allowed.includes(to);
}

export interface VersionRef {
  schemaVersion: number;
  status: string;
}

/**
 * Next contract revision number. Monotonic over every revision that ever existed,
 * including deprecated ones — reusing the number of a retired contract would make an
 * archived event ambiguous.
 */
export function nextSchemaVersion(existing: VersionRef[]): number {
  let max = 0;
  for (const v of existing) {
    if (Number.isInteger(v.schemaVersion) && v.schemaVersion > max) max = v.schemaVersion;
  }
  return max + 1;
}

/**
 * The revision in force: the highest-numbered active one.
 *
 * "Highest wins" rather than "the only one" on purpose. The activate path deprecates the
 * predecessor in the same transaction, so two active rows should be impossible — but if a
 * historical data fix ever leaves two behind, resolving to the newest is a defensible,
 * deterministic answer, whereas throwing would take ingestion down.
 */
export function selectActiveVersion<T extends VersionRef>(versions: T[]): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.status !== "active") continue;
    if (best === null || v.schemaVersion > best.schemaVersion) best = v;
  }
  return best;
}

export function findVersion<T extends VersionRef>(versions: T[], schemaVersion: number): T | null {
  return versions.find((v) => v.schemaVersion === schemaVersion) ?? null;
}

export interface SchemaDiff {
  /** True when an already-emitting producer could be broken by the change. */
  breaking: boolean;
  addedRequired: string[];
  addedOptional: string[];
  removed: string[];
  typeChanged: Array<{ field: string; from: string; to: string }>;
  requirementTightened: string[];
  requirementRelaxed: string[];
}

function specOf(schema: Record<string, unknown>, field: string): { type: string; required: boolean } | null {
  const raw = schema[field];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const spec = raw as { type?: unknown; required?: unknown };
  return {
    type: typeof spec.type === "string" ? spec.type : "unknown",
    required: spec.required === true,
  };
}

/**
 * Compare two revisions of a schema and classify the change.
 *
 * Breaking = a producer that satisfied `previous` may fail `next`, or a consumer reading
 * a declared field may find it gone. Adding an optional field is not breaking; adding a
 * required one, removing a field, tightening an optional field to required, or changing a
 * type all are. Relaxing required → optional is safe and reported for the record.
 */
export function diffSchemas(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): SchemaDiff {
  const addedRequired: string[] = [];
  const addedOptional: string[] = [];
  const removed: string[] = [];
  const typeChanged: Array<{ field: string; from: string; to: string }> = [];
  const requirementTightened: string[] = [];
  const requirementRelaxed: string[] = [];

  for (const field of Object.keys(next).sort()) {
    const nextSpec = specOf(next, field);
    if (nextSpec === null) continue;
    const prevSpec = specOf(previous, field);
    if (prevSpec === null) {
      if (nextSpec.required) addedRequired.push(field);
      else addedOptional.push(field);
      continue;
    }
    if (prevSpec.type !== nextSpec.type) {
      typeChanged.push({ field, from: prevSpec.type, to: nextSpec.type });
    }
    if (!prevSpec.required && nextSpec.required) requirementTightened.push(field);
    if (prevSpec.required && !nextSpec.required) requirementRelaxed.push(field);
  }

  for (const field of Object.keys(previous).sort()) {
    if (specOf(previous, field) === null) continue;
    if (specOf(next, field) === null) removed.push(field);
  }

  const breaking =
    addedRequired.length > 0 ||
    removed.length > 0 ||
    typeChanged.length > 0 ||
    requirementTightened.length > 0;

  return { breaking, addedRequired, addedOptional, removed, typeChanged, requirementTightened, requirementRelaxed };
}

export interface VersionedValidation {
  valid: boolean;
  schemaVersion: number;
  violations: PayloadViolation[];
  unknownFields: string[];
}

/**
 * Validate a payload against one specific revision.
 *
 * The field-level rules are CDP-004's (unknown fields tolerated, missing required and
 * wrong types rejected); the only thing added here is which contract was applied, which
 * the caller needs in order to explain the verdict.
 */
export function validateAgainstVersion(
  payload: Record<string, unknown>,
  version: { schemaVersion: number; schemaJson: Record<string, unknown> },
): VersionedValidation {
  const result = validatePayload(payload, version.schemaJson);
  return {
    valid: result.valid,
    schemaVersion: version.schemaVersion,
    violations: result.violations,
    unknownFields: result.unknownFields,
  };
}
