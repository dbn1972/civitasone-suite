/**
 * Phase 3 derived views — the adapter between a stored service definition and
 * the pure domain modules in packs/ (no I/O).
 *
 * Everything here is COMPUTED per request. None of it is stored, because all of
 * it is a function of blocks the definition already carries: an accessibility
 * verdict, a report set, a KPI list, an RTI entry and a translation inventory
 * are all restatements of the form, pattern, fee and documents. Persisting them
 * would create a second copy that drifts the moment a designer edits the form —
 * and a stale "form passes accessibility" verdict is worse than none.
 *
 * The row carries no `description`, `feeFromMinor` or `feeCurrency` column, so
 * those reach the modules as undefined. The modules already treat them as
 * optional; nothing is invented here to fill the gap.
 */

import { previewAccessibility, type A11yPreviewResult } from "../packs/a11y-preview.js";
import {
  dashboardTilesForPack,
  reportTemplatesForPack,
  type KpiTile,
  type ReportTemplate,
} from "../packs/service-analytics.js";
import { rtiCatalogueEntry, type RtiCatalogueEntry } from "../packs/pack-linkage.js";
import {
  extractTranslatableStrings,
  missingStringsFor,
  translationCoverage,
  type TranslatableString,
  type TranslationCoverage,
} from "../packs/localization.js";
import { SERVICE_PATTERNS, type ServicePattern } from "./domain.js";

/** The shape of a definition row, narrowed to what these views actually read. */
interface DefinitionLike {
  id?: string;
  serviceKey?: string;
  name?: string;
  status?: string;
  servicePattern?: string | null;
  slaDays?: number | null;
  feeModel?: string | null;
  issuanceType?: string | null;
  channels?: unknown;
  requiredDocuments?: unknown;
  outputs?: unknown;
  forms?: unknown;
  locales?: unknown;
  rtiLinkage?: unknown;
}

function localesOf(def: DefinitionLike): string[] {
  return Array.isArray(def.locales) ? (def.locales as string[]) : [];
}

function isServicePattern(v: unknown): v is ServicePattern {
  return typeof v === "string" && (SERVICE_PATTERNS as readonly string[]).includes(v);
}

/**
 * The form design the definition publishes.
 *
 * `forms` is an untyped jsonb array of authored form versions; the first entry
 * is the live one. Returns null when the definition has no form yet, which the
 * callers report explicitly rather than treating as an empty form — "no form
 * authored" and "a form with no fields" are different problems for a designer.
 */
function formDesignOf(def: DefinitionLike): { sections?: unknown[]; fields?: Record<string, unknown> } | null {
  const forms = def.forms;
  if (!Array.isArray(forms) || forms.length === 0) return null;
  const first = forms[0] as { formDesign?: unknown } | null;
  const design = first?.formDesign;
  if (!design || typeof design !== "object") return null;
  return design as { sections?: unknown[]; fields?: Record<string, unknown> };
}

/** Blocks the analytics and RTI modules read, mapped from the row. */
function blocksOf(def: DefinitionLike) {
  return {
    slaDays: def.slaDays ?? undefined,
    feeModel: def.feeModel ?? undefined,
    issuanceType: def.issuanceType ?? undefined,
    channels: Array.isArray(def.channels) ? (def.channels as string[]) : [],
    requiredDocuments: Array.isArray(def.requiredDocuments)
      ? (def.requiredDocuments as { docType: string }[])
      : [],
    outputs: Array.isArray(def.outputs) ? (def.outputs as { type: string }[]) : [],
  };
}

/* ── FN-32 ───────────────────────────────────────────────────────────────── */

export type A11yPreviewResponse =
  | (A11yPreviewResult & { formAuthored: true })
  | { formAuthored: false; passed: false; issues: []; errorCount: 0; warningCount: 0; reason: string };

export function a11yPreviewFor(def: DefinitionLike): A11yPreviewResponse {
  const design = formDesignOf(def);
  if (!design) {
    return {
      formAuthored: false,
      passed: false,
      issues: [],
      errorCount: 0,
      warningCount: 0,
      reason: "No form has been authored for this service yet, so there is nothing to check.",
    };
  }
  return {
    ...previewAccessibility(design as never, { locales: localesOf(def) }),
    formAuthored: true,
  };
}

/* ── FN-16 + FN-31 ───────────────────────────────────────────────────────── */

export type AnalyticsResponse =
  | { pattern: ServicePattern; reports: ReportTemplate[]; tiles: KpiTile[] }
  | { pattern: null; reports: []; tiles: []; reason: string };

export function analyticsFor(def: DefinitionLike): AnalyticsResponse {
  // No defaulting to "certificate" when the pattern is unset. Guessing would
  // hand a department head a plausible report set built on the wrong archetype,
  // which is harder to notice than an explicit gap.
  if (!isServicePattern(def.servicePattern)) {
    return {
      pattern: null,
      reports: [],
      tiles: [],
      reason: "Set a service pattern (B1) before reports and KPIs can be attached.",
    };
  }
  const blocks = blocksOf(def);
  return {
    pattern: def.servicePattern,
    reports: reportTemplatesForPack(def.servicePattern, blocks),
    tiles: dashboardTilesForPack(def.servicePattern, blocks),
  };
}

/* ── FN-28 ───────────────────────────────────────────────────────────────── */

export function rtiEntryFor(def: DefinitionLike): RtiCatalogueEntry | null {
  return rtiCatalogueEntry(def.rtiLinkage as never, {
    serviceKey: def.serviceKey ?? "",
    name: def.name ?? "",
    servicePattern: def.servicePattern ?? null,
    blocks: blocksOf(def),
  });
}

/**
 * Tenant-wide RTI catalogue export.
 *
 * Published definitions only. A draft is not something the public can request
 * information about yet, and listing one would advertise a service that does
 * not exist. rtiCatalogueEntry already returns null for anything not opted in,
 * so the filter below is the publication check, not the opt-in check.
 */
export function rtiExport(defs: readonly DefinitionLike[]): RtiCatalogueEntry[] {
  return defs
    .filter((d) => d.status === "published")
    .map(rtiEntryFor)
    .filter((e): e is RtiCatalogueEntry => e !== null);
}

/* ── FN-18 ───────────────────────────────────────────────────────────────── */

export interface LocalizationResponse {
  locales: string[];
  total: number;
  strings: TranslatableString[];
  /** Present only when a locale was requested. */
  coverage?: TranslationCoverage;
  missing?: TranslatableString[];
}

export function localizationFor(def: DefinitionLike, locale?: string): LocalizationResponse {
  const strings = extractTranslatableStrings({
    forms: def.forms as never,
    requiredDocuments: def.requiredDocuments as never,
  });
  const base: LocalizationResponse = {
    locales: localesOf(def),
    total: strings.length,
    strings,
  };
  if (!locale) return base;

  // Translations are not stored yet — that is the OQ-1 decision. Reporting
  // coverage against an empty bundle is honest: it says every string is
  // outstanding, which is true, rather than implying a store exists.
  const coverage = translationCoverage(strings, locale, {});
  return { ...base, coverage, missing: missingStringsFor(strings, coverage) };
}
