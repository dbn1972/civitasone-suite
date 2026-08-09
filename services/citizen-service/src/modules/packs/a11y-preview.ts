/**
 * FN-32 — Accessibility & GIGW preview (pure domain, no I/O).
 *
 * BRD: "preview block runs WCAG 2.1 AA checks on generated form (labels,
 * contrast hints, focus order); GIGW bilingual warning if secondary locale
 * missing. Acceptance: form missing labels fails preview with actionable list."
 *
 * SCOPE — read this before adding a check. This is a *design-time* audit of the
 * form definition, not a rendered-page audit. It can prove a field has no label;
 * it cannot prove the rendered label has 4.5:1 contrast, that focus lands where
 * a sighted keyboard user expects, or that a screen reader announces the section
 * heading. Those need a DOM and a real browser, which is the "full a11y audit
 * tooling" the BRD lists as the remaining gap. Every check below is therefore
 * one the *definition alone* can settle — a check that guesses at runtime
 * behaviour would give a designer false assurance, which is worse than no check.
 *
 * Contrast specifically is NOT checked here: the form design carries no colour,
 * so contrast is a property of the theme and is asserted by the runtime
 * accessibility gate (FN-13), not by this preview.
 */

export type A11ySeverity = "error" | "warning";

export interface A11yIssue {
  code: string;
  severity: A11ySeverity;
  /** WCAG success criterion this maps to, so the fix is looked up not guessed. */
  wcag: string;
  fieldId?: string | undefined;
  sectionId?: string | undefined;
  /** Actionable: says what to change, not merely what is wrong. */
  message: string;
}

export interface A11yPreviewResult {
  /** False when any error-severity issue is present. Warnings do not block. */
  passed: boolean;
  issues: A11yIssue[];
  errorCount: number;
  warningCount: number;
}

interface PreviewField {
  id: string;
  apiName?: string;
  type?: string;
  label?: string;
  required?: boolean;
  sectionId?: string;
  helpText?: string;
  choices?: unknown[];
  fileTypes?: unknown[];
  pattern?: string;
}

interface PreviewSection {
  id: string;
  label?: string;
  fieldIds?: string[];
}

export interface PreviewFormDesign {
  sections?: PreviewSection[];
  /** Keyed by field id, as pack manifests emit it. */
  fields?: Record<string, PreviewField>;
}

export interface A11yPreviewOptions {
  /** Locales the pack publishes labels in. GIGW expects English + one regional. */
  locales?: readonly string[];
}

const CHOICE_TYPES = new Set(["picklist_single", "picklist_multi", "radio", "checkbox_group"]);
const FILE_TYPES = new Set(["file", "file_multi", "document"]);

function blank(s: unknown): boolean {
  return typeof s !== "string" || s.trim().length === 0;
}

/**
 * Audit a generated form design against the WCAG 2.1 AA criteria a static
 * definition can actually settle.
 */
export function previewAccessibility(
  design: PreviewFormDesign | null | undefined,
  opts: A11yPreviewOptions = {},
): A11yPreviewResult {
  const issues: A11yIssue[] = [];
  const sections = design?.sections ?? [];
  const fields = Object.values(design?.fields ?? {});

  if (fields.length === 0) {
    issues.push({
      code: "FORM_EMPTY",
      severity: "error",
      wcag: "3.3.2 Labels or Instructions",
      message: "The form has no fields. Add at least one field before publishing.",
    });
  }

  const sectionById = new Map(sections.map((s) => [s.id, s]));

  /* ── Labels (the BRD's named acceptance case) ── */
  for (const f of fields) {
    if (blank(f.label)) {
      issues.push({
        code: "FIELD_MISSING_LABEL",
        severity: "error",
        wcag: "3.3.2 Labels or Instructions",
        fieldId: f.id,
        message: `Field "${f.apiName ?? f.id}" has no label. Add a visible label — a placeholder is not announced by screen readers and disappears once the citizen types.`,
      });
    }
  }

  /* ── Distinguishable labels within a section ── */
  for (const section of sections) {
    const seen = new Map<string, string>();
    for (const fieldId of section.fieldIds ?? []) {
      const f = design?.fields?.[fieldId];
      if (!f || blank(f.label)) continue;
      const key = f.label!.trim().toLowerCase();
      const prior = seen.get(key);
      if (prior) {
        issues.push({
          code: "DUPLICATE_LABEL_IN_SECTION",
          severity: "error",
          wcag: "2.4.6 Headings and Labels",
          fieldId,
          sectionId: section.id,
          message: `"${f.label}" is used by two fields in "${section.label ?? section.id}" (${prior} and ${fieldId}). A screen-reader user hearing the label twice cannot tell them apart — make each label distinct.`,
        });
      } else {
        seen.set(key, fieldId);
      }
    }
  }

  /* ── Section structure & focus order ── */
  for (const section of sections) {
    if (blank(section.label)) {
      issues.push({
        code: "SECTION_MISSING_LABEL",
        severity: "error",
        wcag: "1.3.1 Info and Relationships",
        sectionId: section.id,
        message: `Section "${section.id}" has no heading. Add one so the form's structure is announced and navigable by heading.`,
      });
    }
  }

  // Focus order is the order fields appear in their section. A field that no
  // section lists has no defined position, so tab order becomes render-order
  // chance — that is a definition defect, detectable without a browser.
  const placed = new Map<string, string[]>();
  for (const section of sections) {
    for (const fieldId of section.fieldIds ?? []) {
      if (!design?.fields?.[fieldId]) {
        issues.push({
          code: "SECTION_REFERENCES_MISSING_FIELD",
          severity: "error",
          wcag: "1.3.1 Info and Relationships",
          sectionId: section.id,
          fieldId,
          message: `Section "${section.label ?? section.id}" lists field "${fieldId}", which does not exist. Remove the reference or add the field.`,
        });
        continue;
      }
      placed.set(fieldId, [...(placed.get(fieldId) ?? []), section.id]);
    }
  }
  for (const f of fields) {
    const where = placed.get(f.id) ?? [];
    if (where.length === 0) {
      issues.push({
        code: "FIELD_NOT_IN_ANY_SECTION",
        severity: "error",
        wcag: "2.4.3 Focus Order",
        fieldId: f.id,
        message: `Field "${f.apiName ?? f.id}" is not listed in any section, so it has no position in the tab order. Add it to a section's field list.`,
      });
    } else if (where.length > 1) {
      issues.push({
        code: "FIELD_IN_MULTIPLE_SECTIONS",
        severity: "error",
        wcag: "2.4.3 Focus Order",
        fieldId: f.id,
        message: `Field "${f.apiName ?? f.id}" appears in ${where.length} sections (${where.join(", ")}). It would be reached twice while tabbing — keep it in one.`,
      });
    }
    // A field pointing at a section that does not exist is the mirror defect.
    if (f.sectionId && !sectionById.has(f.sectionId)) {
      issues.push({
        code: "FIELD_UNKNOWN_SECTION",
        severity: "error",
        wcag: "1.3.1 Info and Relationships",
        fieldId: f.id,
        message: `Field "${f.apiName ?? f.id}" belongs to section "${f.sectionId}", which is not defined on this form.`,
      });
    }
  }

  /* ── Instructions the citizen needs before they can answer (3.3.2) ── */
  for (const f of fields) {
    if (CHOICE_TYPES.has(f.type ?? "") && (f.choices ?? []).length === 0) {
      issues.push({
        code: "CHOICE_FIELD_WITHOUT_CHOICES",
        severity: "error",
        wcag: "3.3.2 Labels or Instructions",
        fieldId: f.id,
        message: `Choice field "${f.apiName ?? f.id}" has no options, so it cannot be answered. Add the options.`,
      });
    }
    if (FILE_TYPES.has(f.type ?? "") && (f.fileTypes ?? []).length === 0) {
      issues.push({
        code: "UPLOAD_WITHOUT_ACCEPTED_TYPES",
        severity: "warning",
        wcag: "3.3.2 Labels or Instructions",
        fieldId: f.id,
        message: `Upload field "${f.apiName ?? f.id}" does not say which file types are accepted. State them so the citizen is not corrected only after a failed upload.`,
      });
    }
    if (!blank(f.pattern) && blank(f.helpText)) {
      // Error prevention: a format rule the citizen cannot see before typing
      // produces an error message instead of a successful first attempt.
      issues.push({
        code: "FORMAT_RULE_WITHOUT_HELP_TEXT",
        severity: "warning",
        wcag: "3.3.5 Help",
        fieldId: f.id,
        message: `Field "${f.apiName ?? f.id}" enforces a format but gives no help text. Describe the expected format in plain language.`,
      });
    }
  }

  /* ── GIGW bilingual ── */
  const locales = opts.locales ?? [];
  if (locales.length < 2) {
    issues.push({
      code: "GIGW_SECONDARY_LOCALE_MISSING",
      severity: "warning",
      wcag: "GIGW 3.0 — bilingual content",
      message:
        locales.length === 0
          ? "No locale is declared for this service. GIGW expects content in English and at least one regional language."
          : `Only "${locales[0]}" is declared. GIGW expects a second language; add the regional locale for this state.`,
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  return {
    passed: errorCount === 0,
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
  };
}

/** One-line-per-issue rendering for the Designer's preview panel and CI logs. */
export function formatA11yIssues(result: A11yPreviewResult): string[] {
  return result.issues.map(
    (i) => `[${i.severity.toUpperCase()}] ${i.code} (${i.wcag}) — ${i.message}`,
  );
}
