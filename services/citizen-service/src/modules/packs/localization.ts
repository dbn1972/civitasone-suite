/**
 * FN-18 — Localization: the storage-agnostic half (pure domain, no I/O).
 *
 * BRD: "per-locale strings on all text-bearing blocks; runtime renders applicant
 * language … Gap: follow-up architecture decision before estimate."
 *
 * WHAT IS AND IS NOT BUILT HERE — read before extending.
 *
 * FN-18 is blocked on OQ-1: "build new i18n-service, extend
 * notification-service/i18n, or tenant-scoped jsonb on metadata forms?" Those
 * three are mutually exclusive, and picking one in code would settle an open
 * architecture question by stealth. So the *runtime rendering* half — where
 * translations live, how they are fetched, how a locale is resolved per request
 * — is deliberately absent and stays absent until OQ-1 is answered.
 *
 * What is built is the half all three answers need identically: given a pack,
 * which strings require translation, under what stable keys, and does a given
 * translation set cover them. Every candidate architecture must produce exactly
 * this inventory; none of them changes it. It also makes FN-32's GIGW warning
 * actionable — that check can say a second locale is missing, this one says
 * which 47 strings the translator has to write.
 *
 * Keys are derived from pack-authored ids (field id, section id, docType, lane
 * key), not from array positions, so reordering a form does not silently
 * invalidate every existing translation.
 */

export interface TranslatableString {
  /** Stable, storage-independent key. Survives reordering; breaks only if the id changes. */
  key: string;
  /** The source-language text, i.e. what the translator is given. */
  source: string;
  /** Where it appears — lets a translator resolve an ambiguous short label. */
  context: string;
  /** Citizen-facing strings must be translated; officer-facing is advisory. */
  audience: "citizen" | "officer";
}

interface LocField {
  id: string;
  apiName?: string;
  label?: string;
  helpText?: string;
  choices?: unknown[];
}

interface LocSection {
  id: string;
  label?: string;
}

export interface LocalizableBlocks {
  description?: string | undefined;
  applicantTypeRejectMessage?: string | null | undefined;
  forms?: readonly { formDesign: { sections?: LocSection[]; fields?: Record<string, LocField> } }[] | undefined;
  requiredDocuments?: readonly { docType: string; label?: string }[] | undefined;
  laneBindings?: readonly { key: string; name?: string }[] | undefined;
}

function push(out: TranslatableString[], s: TranslatableString): void {
  if (typeof s.source !== "string" || s.source.trim().length === 0) return;
  out.push(s);
}

/**
 * Every string in a pack that a translator must render into another language.
 *
 * Order is stable (service → form → documents → lanes) so a diff between two
 * pack versions shows what a translator has to revisit.
 */
export function extractTranslatableStrings(
  blocks: LocalizableBlocks | null | undefined,
): TranslatableString[] {
  const out: TranslatableString[] = [];
  if (!blocks) return out;

  push(out, {
    key: "service.description",
    source: blocks.description ?? "",
    context: "Service description shown on the catalogue card and the apply page",
    audience: "citizen",
  });

  if (blocks.applicantTypeRejectMessage) {
    push(out, {
      key: "service.applicantTypeRejectMessage",
      source: blocks.applicantTypeRejectMessage,
      context: "Shown when an applicant type may not use this service",
      audience: "citizen",
    });
  }

  for (const form of blocks.forms ?? []) {
    const design = form.formDesign ?? {};
    for (const section of design.sections ?? []) {
      push(out, {
        key: `form.section.${section.id}.label`,
        source: section.label ?? "",
        context: "Form section heading",
        audience: "citizen",
      });
    }
    for (const field of Object.values(design.fields ?? {})) {
      const name = field.apiName ?? field.id;
      push(out, {
        key: `form.field.${field.id}.label`,
        source: field.label ?? "",
        context: `Label for form field "${name}"`,
        audience: "citizen",
      });
      push(out, {
        key: `form.field.${field.id}.helpText`,
        source: field.helpText ?? "",
        context: `Help text under form field "${name}"`,
        audience: "citizen",
      });
      // Choices are keyed by their source text, not by index: a picklist whose
      // options are reordered or extended must not invalidate the translations
      // of the options that did not change.
      for (const choice of field.choices ?? []) {
        if (typeof choice !== "string") continue;
        push(out, {
          key: `form.field.${field.id}.choice.${slug(choice)}`,
          source: choice,
          context: `Option of form field "${name}"`,
          audience: "citizen",
        });
      }
    }
  }

  for (const doc of blocks.requiredDocuments ?? []) {
    push(out, {
      key: `document.${doc.docType}.label`,
      source: doc.label ?? "",
      context: "Name of a document the citizen must upload",
      audience: "citizen",
    });
  }

  for (const lane of blocks.laneBindings ?? []) {
    push(out, {
      key: `lane.${lane.key}.name`,
      source: lane.name ?? "",
      // Lane names reach the citizen through status tracking ("with Facility
      // Clerk"), so they are worth translating even though officers see them most.
      context: "Workflow stage name, also shown in citizen status tracking",
      audience: "officer",
    });
  }

  return out;
}

/** Lowercase, punctuation-free, hyphenated — stable across whitespace edits. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface TranslationCoverage {
  locale: string;
  total: number;
  translated: number;
  /** Percent of required strings present, rounded down. 100 only when complete. */
  percent: number;
  /** Keys with no translation, in extraction order. */
  missingKeys: string[];
  /** Keys present in the bundle that no longer exist in the pack. */
  staleKeys: string[];
  complete: boolean;
}

/**
 * Compare a translation bundle against what the pack actually needs.
 *
 * `bundle` is a flat key → text map, which every candidate OQ-1 architecture can
 * produce regardless of where it stores the data.
 *
 * A translation identical to the source counts as missing: for a language with a
 * different script that is almost always an untouched placeholder rather than a
 * deliberate choice, and shipping it would make a form look bilingual when it is
 * not. Latin-script strings that legitimately do not change (proper nouns, "PAN")
 * are the cost of that; flagging one is cheap, missing an untranslated form is not.
 */
export function translationCoverage(
  strings: readonly TranslatableString[],
  locale: string,
  bundle: Record<string, string> | null | undefined,
): TranslationCoverage {
  const b = bundle ?? {};
  const required = new Set(strings.map((s) => s.key));

  const missingKeys: string[] = [];
  for (const s of strings) {
    const value = b[s.key];
    if (typeof value !== "string" || value.trim().length === 0 || value.trim() === s.source.trim()) {
      missingKeys.push(s.key);
    }
  }

  const staleKeys = Object.keys(b).filter((k) => !required.has(k));
  const total = strings.length;
  const translated = total - missingKeys.length;

  return {
    locale,
    total,
    translated,
    percent: total === 0 ? 100 : Math.floor((translated / total) * 100),
    missingKeys,
    staleKeys,
    complete: missingKeys.length === 0,
  };
}

/** Translator-facing worklist: only what is still missing, with its context. */
export function missingStringsFor(
  strings: readonly TranslatableString[],
  coverage: TranslationCoverage,
): TranslatableString[] {
  const missing = new Set(coverage.missingKeys);
  return strings.filter((s) => missing.has(s.key));
}
