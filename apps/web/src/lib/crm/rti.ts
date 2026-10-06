/**
 * GAP-CRM-RTI-06: single source of truth for RTI section labels.
 *
 * The register table (RtiTable), the detail page and the new-request form each
 * carried their own section→label map, and they had drifted: the table said
 * "§6 Information" / "§11 Third-party" while the detail and new screens said
 * "§6 — Information Request" / "§11 — Third-party Information". That is pure
 * label drift (the raw values "s.6"/"s.11" always agreed). This module exports
 * one canonical list plus a `sectionLabel(value, short?)` helper so every screen
 * names a section the same way; the table may opt into a documented short form.
 */

export interface RtiSectionDef {
  value: string;
  /** Full statutory label used on the detail page and the new-request form. */
  label: string;
  /** Compact label for dense views such as the register table pill. */
  short: string;
}

export const RTI_SECTIONS: readonly RtiSectionDef[] = [
  { value: "s.6", label: "§6 — Information Request", short: "§6 Information" },
  { value: "s.11", label: "§11 — Third-party Information", short: "§11 Third-party" },
] as const;

const BY_VALUE = new Map(RTI_SECTIONS.map((s) => [s.value, s]));

/**
 * Human label for a section value. Unknown sections return the raw value so an
 * unexpected enum is still shown (not blanked). `short` picks the compact form
 * used by the dense register table.
 */
export function sectionLabel(value: string, short = false): string {
  const def = BY_VALUE.get(value);
  if (!def) return value;
  return short ? def.short : def.label;
}
