"use client";

import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import {
  ELIGIBILITY_OPERATORS,
  PROFILE_ATTRIBUTES,
  effectApiToUi,
  effectUiToApi,
  type EligibilityDesignState,
  type EligibilityEvalResult,
  type EligibilityOp,
  type EligibilityRuleUi,
} from "@/app/_components/ds/designer/eligibilityTypes";

export type SampleFieldGroup = "profile" | "form";

export interface SampleSubjectField {
  id: string;
  label: string;
  valueType: "text" | "number" | "boolean";
  group: SampleFieldGroup;
}

interface ApiRule {
  id: string;
  attribute: string;
  op: EligibilityOp;
  value?: unknown;
  effect: "disqualify" | "refer";
  label?: string;
}

interface RuleSetDto {
  id: string;
  name: string;
  rules: ApiRule[];
  status: string;
}

async function parseJson(res: Response): Promise<unknown> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function parseRuleValue(raw: string | undefined, op: EligibilityOp): unknown {
  if (!raw && op !== "exists" && op !== "missing") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (raw !== "" && Number.isFinite(num)) return num;
  return raw;
}

export function rulesUiToApi(rules: EligibilityRuleUi[]): ApiRule[] {
  return rules.map((r) => ({
    id: r.id,
    attribute: r.attribute,
    op: r.op,
    value: parseRuleValue(r.value, r.op),
    effect: effectUiToApi(r.effect),
    label: r.message || undefined,
  }));
}

export function rulesApiToUi(rules: ApiRule[]): EligibilityRuleUi[] {
  return rules.map((r) => ({
    id: r.id,
    attribute: r.attribute,
    op: r.op,
    value: r.value === undefined || r.value === null ? "" : String(r.value),
    effect: effectApiToUi(r.effect),
    message: r.label ?? "",
  }));
}

export function emptyEligibilityDesign(serviceName: string): EligibilityDesignState {
  return { name: `${serviceName} eligibility`, rules: [] };
}

export async function loadEligibilityDesign(
  serviceId: string,
  serviceName: string,
  ruleSetId?: string | null,
): Promise<EligibilityDesignState> {
  if (ruleSetId) {
    const res = await fetch(`/api/proxy/v1/citizen/eligibility/rule-sets/${ruleSetId}`, { cache: "no-store" });
    if (res.ok) {
      const rs = (await res.json()) as RuleSetDto;
      return { ruleSetId: rs.id, name: rs.name, rules: rulesApiToUi(rs.rules ?? []) };
    }
  }

  const listRes = await fetch("/api/proxy/v1/citizen/eligibility/rule-sets", { cache: "no-store" });
  if (listRes.ok) {
    const payload = (await listRes.json()) as { data?: { id: string; serviceId: string; status: string }[] };
    const draft = (payload.data ?? []).find((r) => r.serviceId === serviceId && r.status === "draft");
    if (draft) {
      const detail = await fetch(`/api/proxy/v1/citizen/eligibility/rule-sets/${draft.id}`, { cache: "no-store" });
      if (detail.ok) {
        const rs = (await detail.json()) as RuleSetDto;
        return { ruleSetId: rs.id, name: rs.name, rules: rulesApiToUi(rs.rules ?? []) };
      }
    }
  }

  return emptyEligibilityDesign(serviceName);
}

export async function persistEligibilityDesign(
  design: EligibilityDesignState,
  serviceId: string,
  serviceName: string,
): Promise<EligibilityDesignState> {
  const apiRules = rulesUiToApi(design.rules);
  const name = design.name || `${serviceName} eligibility`;

  if (design.ruleSetId) {
    await parseJson(await fetch(`/api/proxy/v1/citizen/eligibility/rule-sets/${design.ruleSetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, rules: apiRules }),
    }));
    return { ...design, name, rules: design.rules };
  }

  const created = (await parseJson(await fetch("/api/proxy/v1/citizen/eligibility/rule-sets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serviceId, name, rules: apiRules }),
  }))) as { id: string };

  return { ...design, ruleSetId: created.id, name, rules: design.rules };
}

/** Client-side eligibility evaluation for the sample-applicant test panel. */
export function evaluateEligibilityLocal(
  rules: EligibilityRuleUi[],
  subject: Record<string, unknown>,
): EligibilityEvalResult {
  const reasons: EligibilityEvalResult["reasons"] = [];
  let disqualified = false;
  let refer = false;

  for (const rule of rules) {
    const passed = evaluateSingleRule(rule, subject);
    const message = rule.message || `${rule.attribute} ${rule.op}${rule.value ? ` ${rule.value}` : ""}`;
    reasons.push({
      ruleId: rule.id,
      passed,
      message: passed ? `Passed: ${message}` : `Failed: ${message}`,
    });
    if (!passed) {
      if (rule.effect === "block") disqualified = true;
      else refer = true;
    }
  }

  const outcome = disqualified ? "not_eligible" : refer ? "refer_manual" : "eligible";
  return { outcome, reasons };
}

function evaluateSingleRule(rule: EligibilityRuleUi, subject: Record<string, unknown>): boolean {
  const present = Object.prototype.hasOwnProperty.call(subject, rule.attribute)
    && subject[rule.attribute] !== null && subject[rule.attribute] !== undefined;
  const actual = subject[rule.attribute];
  const expected = parseRuleValue(rule.value, rule.op);

  switch (rule.op) {
    case "exists":
      return present;
    case "missing":
      return !present;
    case "eq":
      return present && actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (rule.op === "gt") return a > b;
      if (rule.op === "gte") return a >= b;
      if (rule.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

export function buildSampleSubjectFields(
  rules: EligibilityRuleUi[],
  formFields: FormFieldDefinition[],
): SampleSubjectField[] {
  const seen = new Set<string>();
  const fields: SampleSubjectField[] = [];
  for (const rule of rules) {
    if (seen.has(rule.attribute)) continue;
    seen.add(rule.attribute);
    const profile = PROFILE_ATTRIBUTES.find((a) => a.id === rule.attribute);
    const form = formFields.find((f) => f.apiName === rule.attribute);
    const valueType: SampleSubjectField["valueType"] =
      profile?.valueType
      ?? (form?.type === "number" ? "number" : form?.type === "boolean" ? "boolean" : "text");
    fields.push({
      id: rule.attribute,
      label: profile?.label ?? form?.label ?? rule.attribute.replace(/_/g, " "),
      valueType,
      group: profile ? "profile" : "form",
    });
  }
  return fields;
}

export function subjectFromSampleValues(
  sampleFields: SampleSubjectField[],
  sampleValues: Record<string, string>,
): Record<string, unknown> {
  const subject: Record<string, unknown> = {};
  for (const f of sampleFields) {
    const raw = sampleValues[f.id] ?? "";
    if (raw === "") continue;
    if (f.valueType === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) subject[f.id] = n;
    } else if (f.valueType === "boolean") {
      subject[f.id] = raw === "true";
    } else {
      subject[f.id] = raw;
    }
  }
  return subject;
}

function passingValueForRule(rule: EligibilityRuleUi, valueType: SampleSubjectField["valueType"]): string {
  const op = rule.op;
  const v = rule.value ?? "";
  if (op === "exists") {
    if (valueType === "boolean") return "true";
    if (valueType === "number") return "1";
    return "sample";
  }
  if (op === "missing") return "";
  if (op === "eq") {
    if (valueType === "boolean") return v === "false" ? "false" : "true";
    return v || (valueType === "number" ? "0" : "match");
  }
  if (op === "neq") {
    if (valueType === "boolean") return v === "true" ? "false" : "true";
    if (valueType === "number") {
      const n = Number(v);
      return Number.isFinite(n) ? String(n + 1) : "0";
    }
    return v ? `${v}_other` : "other";
  }
  if (op === "gt" || op === "gte") {
    const n = Number(v);
    const base = Number.isFinite(n) ? n : 0;
    return String(op === "gt" ? base + 1 : base);
  }
  if (op === "lt" || op === "lte") {
    const n = Number(v);
    const base = Number.isFinite(n) ? n : 0;
    return String(op === "lt" ? base - 1 : base);
  }
  return v;
}

function failingValueForRule(rule: EligibilityRuleUi, valueType: SampleSubjectField["valueType"]): string {
  const op = rule.op;
  const v = rule.value ?? "";
  if (op === "exists") return "";
  if (op === "missing") {
    if (valueType === "boolean") return "true";
    if (valueType === "number") return "1";
    return "present";
  }
  if (op === "eq") {
    if (valueType === "boolean") return v === "true" ? "false" : "true";
    if (valueType === "number") {
      const n = Number(v);
      return Number.isFinite(n) ? String(n + 1) : "0";
    }
    return v ? `${v}_no` : "no";
  }
  if (op === "neq") return v || (valueType === "number" ? "0" : "match");
  if (op === "gt" || op === "gte") {
    const n = Number(v);
    const base = Number.isFinite(n) ? n : 0;
    return String(op === "gte" ? base - 1 : base);
  }
  if (op === "lt" || op === "lte") {
    const n = Number(v);
    const base = Number.isFinite(n) ? n : 0;
    return String(op === "lte" ? base + 1 : base);
  }
  return "";
}

/** Fill sample inputs so every rule passes (for the “Eligible sample” shortcut). */
export function suggestPassingSampleValues(
  rules: EligibilityRuleUi[],
  formFields: FormFieldDefinition[],
): Record<string, string> {
  const fields = buildSampleSubjectFields(rules, formFields);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const values: Record<string, string> = {};
  for (const rule of rules) {
    const field = byId.get(rule.attribute);
    if (!field) continue;
    const next = passingValueForRule(rule, field.valueType);
    if (next !== "") values[rule.attribute] = next;
    else delete values[rule.attribute];
  }
  return values;
}

/**
 * Fill sample inputs so the first blocking rule fails (and others still pass when possible).
 * Falls back to failing the first rule if none use the Block effect.
 */
export function suggestFailingSampleValues(
  rules: EligibilityRuleUi[],
  formFields: FormFieldDefinition[],
): Record<string, string> {
  const values = suggestPassingSampleValues(rules, formFields);
  const target = rules.find((r) => r.effect === "block") ?? rules[0];
  if (!target) return values;
  const fields = buildSampleSubjectFields(rules, formFields);
  const field = fields.find((f) => f.id === target.attribute);
  if (!field) return values;
  const fail = failingValueForRule(target, field.valueType);
  if (fail === "") {
    const next = { ...values };
    delete next[target.attribute];
    return next;
  }
  return { ...values, [target.attribute]: fail };
}

export function outcomeLabel(outcome: EligibilityEvalResult["outcome"]): string {
  if (outcome === "eligible") return "Eligible";
  if (outcome === "not_eligible") return "Not eligible";
  return "Flagged for review";
}

export function operatorNeedsValue(op: EligibilityOp): boolean {
  return ELIGIBILITY_OPERATORS.find((o) => o.id === op)?.needsValue ?? true;
}
