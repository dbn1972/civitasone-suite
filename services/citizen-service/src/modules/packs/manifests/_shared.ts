/**
 * Shared builders for pack manifests.
 *
 * Every manifest previously re-declared the same `field()` helper. With a
 * catalogue of this size that is a real hazard rather than mere duplication: a
 * pack whose local copy drifts (say, defaulting `required` the other way) would
 * produce a form that looks like its neighbours and behaves differently. One
 * definition, one behaviour.
 */

export interface PackField {
  id: string;
  apiName: string;
  type: string;
  label: string;
  required: boolean;
  sectionId: string;
  helpText?: string;
  choices?: string[];
  fileTypes?: string[];
  fileMaxMb?: number;
  [k: string]: unknown;
}

/**
 * Build a form field. Required by default — a government form asks for what it
 * needs, and an optional field should be a deliberate choice by the pack author
 * rather than the result of forgetting a flag.
 */
export function field(
  id: string,
  apiName: string,
  label: string,
  type: string,
  sectionId: string,
  extra: Record<string, unknown> = {},
): PackField {
  return {
    id,
    apiName,
    type,
    label,
    required: extra.required === false ? false : true,
    sectionId,
    ...extra,
  } as PackField;
}

/**
 * Assemble the form design from a flat field list plus section labels.
 *
 * Section order follows the order of `sections`, and each section's field order
 * follows the field list — so the tab order a citizen experiences is exactly the
 * order the pack author wrote, with no separate ordering to keep in sync. FN-32
 * checks that every field lands in exactly one section; building it this way
 * makes that structurally true instead of merely tested.
 */
export function formDesignFrom(
  fields: PackField[],
  sections: { id: string; label: string }[],
  formId: string,
) {
  return {
    sections: sections.map((s) => ({
      id: s.id,
      label: s.label,
      fieldIds: fields.filter((f) => f.sectionId === s.id).map((f) => f.id),
    })),
    fields: Object.fromEntries(fields.map((f) => [f.id, f])),
    formId,
  };
}

/** Rupees to paise. Money stays in minor units from here to the ledger. */
export function rupees(amount: number): number {
  return Math.round(amount * 100);
}
