/**
 * GAP-CRM-RTI-06: single source of truth for RTI section labels.
 *
 * The register table (RtiTable), the detail page and the new-request form each
 * carried their own section→label map, and they had drifted: the table said
 * "§6 Information" / "§11 Third-party" while the detail and new screens said
 * "§6 — Information Request" / "§11 — Third-party Information". That is pure
 * label drift (the raw values "s.6"/"s.11" always agreed). This module exports
 * one canonical list plus helpers so every screen names a section the same way.
 *
 * Every SCREEN (register table, filters, detail, new-request form) renders the section
 * through `localisedSectionLabel`, which reads the ONE `crmRtiSections` i18n namespace,
 * so the wording (and its Hindi) cannot drift per screen again. `sectionLabel(value,
 * short?)` is the plain-English form for non-UI callers (CSV, logs) and tests.
 */

/** The single i18n namespace every RTI screen reads its section labels from. */
export const RTI_SECTION_I18N_NAMESPACE = "crmRtiSections";

export interface RtiSectionDef {
  value: string;
  /** Full statutory label (plain English, for non-UI callers). */
  label: string;
  /** Compact English label for non-UI callers; no screen uses it any more. */
  short: string;
  /** Key of the label in the `crmRtiSections` namespace. */
  labelKey: "section6" | "section11";
}

export const RTI_SECTIONS: readonly RtiSectionDef[] = [
  { value: "s.6", label: "§6 — Information Request", short: "§6 Information", labelKey: "section6" },
  { value: "s.11", label: "§11 — Third-party Information", short: "§11 Third-party", labelKey: "section11" },
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

/**
 * The localised label for a section value, via a translator bound to the
 * `crmRtiSections` namespace (`useTranslations` / `getTranslations`). An unknown
 * section returns the raw value rather than a blank or a missing-key error.
 */
export function localisedSectionLabel(t: (key: "section6" | "section11") => string, value: string): string {
  const def = BY_VALUE.get(value);
  return def ? t(def.labelKey) : value;
}
