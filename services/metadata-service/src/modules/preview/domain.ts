/**
 * Config preview / dry-run engine (CAP-117).
 *
 * Given a proposed configuration change, compute its effect and diagnostics
 * WITHOUT persisting anything. This lets a tenant admin see exactly what a new
 * field, validation rule, or entity would do — including how it classifies a
 * set of sample records — before committing it. Pure and side-effect-free.
 */

import { validateFieldValue, evaluateExpression, type FieldDef } from "../rules/domain.js";
import { validateFormula, evaluateFormula } from "../formula/domain.js";

const API_NAME_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_TYPES = new Set(["text", "number", "currency", "date", "boolean", "picklist", "lookup", "formula"]);

export interface FieldPreviewInput {
  kind: "field";
  field: {
    apiName: string;
    label?: string;
    fieldType: string;
    isRequired?: boolean;
    picklistValues?: string[];
  };
  existingFieldApiNames?: string[];
  sampleRecords?: Record<string, unknown>[];
}

export interface RulePreviewInput {
  kind: "validationRule";
  rule: { name: string; expression: string; errorMessage: string };
  sampleRecords?: Record<string, unknown>[];
}

export interface FormulaPreviewInput {
  kind: "formula";
  expression: string;
  sampleRecords?: Record<string, unknown>[];
}

export interface EntityPreviewInput {
  kind: "entity";
  entity: { apiName: string; label?: string };
  existingEntityApiNames?: string[];
}

export type ConfigPreviewInput =
  | FieldPreviewInput
  | RulePreviewInput
  | FormulaPreviewInput
  | EntityPreviewInput;

export interface SampleOutcome {
  index: number;
  passes: boolean;
  detail?: string;
}

export interface ConfigPreviewResult {
  kind: string;
  valid: boolean;
  wouldPersist: false;
  diagnostics: string[];
  sampleOutcomes?: SampleOutcome[];
  summary?: Record<string, unknown>;
}

export function previewConfigChange(input: ConfigPreviewInput): ConfigPreviewResult {
  switch (input.kind) {
    case "field":
      return previewField(input);
    case "validationRule":
      return previewRule(input);
    case "formula":
      return previewFormula(input);
    case "entity":
      return previewEntity(input);
    default:
      return { kind: "unknown", valid: false, wouldPersist: false, diagnostics: ["unknown change kind"] };
  }
}

function previewField(input: FieldPreviewInput): ConfigPreviewResult {
  const diagnostics: string[] = [];
  const f = input.field;
  if (!API_NAME_RE.test(f.apiName)) diagnostics.push(`invalid apiName "${f.apiName}" (must match ${API_NAME_RE})`);
  if (!FIELD_TYPES.has(f.fieldType)) diagnostics.push(`unknown fieldType "${f.fieldType}"`);
  if ((input.existingFieldApiNames ?? []).includes(f.apiName)) diagnostics.push(`field "${f.apiName}" already exists on this entity`);
  if (f.fieldType === "picklist" && (!f.picklistValues || f.picklistValues.length === 0)) {
    diagnostics.push("picklist field requires picklistValues");
  }

  const fieldDef: FieldDef = {
    apiName: f.apiName,
    fieldType: f.fieldType,
    isRequired: f.isRequired ?? false,
    ...(f.label !== undefined ? { label: f.label } : {}),
    ...(f.picklistValues !== undefined ? { picklistValues: f.picklistValues } : {}),
  };

  const sampleOutcomes: SampleOutcome[] = (input.sampleRecords ?? []).map((rec, index) => {
    const err = validateFieldValue(rec[f.apiName], fieldDef);
    return { index, passes: err === null, ...(err ? { detail: err } : {}) };
  });

  const passing = sampleOutcomes.filter((s) => s.passes).length;
  return {
    kind: "field",
    valid: diagnostics.length === 0,
    wouldPersist: false,
    diagnostics,
    ...(sampleOutcomes.length ? { sampleOutcomes } : {}),
    summary: { samples: sampleOutcomes.length, passing, failing: sampleOutcomes.length - passing },
  };
}

function previewRule(input: RulePreviewInput): ConfigPreviewResult {
  const diagnostics: string[] = [];
  if (!input.rule.expression?.trim()) diagnostics.push("rule expression is empty");
  if (!input.rule.errorMessage?.trim()) diagnostics.push("rule errorMessage is empty");

  const sampleOutcomes: SampleOutcome[] = (input.sampleRecords ?? []).map((rec, index) => {
    try {
      const passes = evaluateExpression(input.rule.expression, rec);
      return { index, passes, ...(passes ? {} : { detail: input.rule.errorMessage }) };
    } catch (err) {
      return { index, passes: false, detail: err instanceof Error ? err.message : String(err) };
    }
  });

  const passing = sampleOutcomes.filter((s) => s.passes).length;
  return {
    kind: "validationRule",
    valid: diagnostics.length === 0,
    wouldPersist: false,
    diagnostics,
    ...(sampleOutcomes.length ? { sampleOutcomes } : {}),
    summary: { samples: sampleOutcomes.length, passing, failing: sampleOutcomes.length - passing },
  };
}

function previewFormula(input: FormulaPreviewInput): ConfigPreviewResult {
  const check = validateFormula(input.expression);
  const diagnostics: string[] = [];
  if (!check.valid) diagnostics.push(check.error ?? "invalid formula");

  const results: unknown[] = [];
  const sampleOutcomes: SampleOutcome[] = (input.sampleRecords ?? []).map((rec, index) => {
    try {
      const value = evaluateFormula(input.expression, rec);
      results.push(value);
      return { index, passes: true, detail: `= ${String(value)}` };
    } catch (err) {
      return { index, passes: false, detail: err instanceof Error ? err.message : String(err) };
    }
  });

  return {
    kind: "formula",
    valid: diagnostics.length === 0,
    wouldPersist: false,
    diagnostics,
    ...(sampleOutcomes.length ? { sampleOutcomes } : {}),
    summary: { results },
  };
}

function previewEntity(input: EntityPreviewInput): ConfigPreviewResult {
  const diagnostics: string[] = [];
  if (!API_NAME_RE.test(input.entity.apiName)) diagnostics.push(`invalid apiName "${input.entity.apiName}"`);
  if ((input.existingEntityApiNames ?? []).includes(input.entity.apiName)) {
    diagnostics.push(`entity "${input.entity.apiName}" already exists`);
  }
  return { kind: "entity", valid: diagnostics.length === 0, wouldPersist: false, diagnostics };
}
