/** Request bodies for the G2 pay-component API, and the merge of a body into a full ComponentSpec. */
import { z } from "zod";
import {
  COMPONENT_CALC_TYPES, COMPONENT_TYPES, COST_PLACEMENTS, EMPLOYER_COST_CLASSES,
  type ComponentSpec, type ComponentCalcType, type ComponentType, type CostPlacement, type EmployerCostClass,
} from "./model.js";

const digits = z.string().regex(/^\d{1,16}$/, "must be a whole number of paise");

const componentFields = {
  name: z.string().trim().min(1).max(128),
  componentType: z.enum(COMPONENT_TYPES),
  isTaxable: z.boolean(),
  calc: z.enum(COMPONENT_CALC_TYPES).nullable(),
  pctOfBasic: z.number().min(0).max(100).nullable(),
  pctOfCtcBps: z.number().int().min(0).max(10000).nullable(),
  fixedMinor: digits.nullable(),
  employerCostClass: z.enum(EMPLOYER_COST_CLASSES).nullable(),
  costPlacement: z.enum(COST_PLACEMENTS),
  countsForPfWage: z.boolean(),
  countsForEsiWage: z.boolean(),
  countsForGratuity: z.boolean(),
  lopApplicable: z.boolean(),
  payslipOrder: z.number().int().min(0).max(32000).nullable(),
};

export const createComponentBody = z.object({
  code: z.string().trim().min(1).max(32),
  name: componentFields.name,
  componentType: componentFields.componentType.optional(),
  isTaxable: componentFields.isTaxable.default(false),
  calc: componentFields.calc.optional(),
  pctOfBasic: componentFields.pctOfBasic.optional(),
  pctOfCtcBps: componentFields.pctOfCtcBps.optional(),
  fixedMinor: componentFields.fixedMinor.optional(),
  employerCostClass: componentFields.employerCostClass.optional(),
  costPlacement: componentFields.costPlacement.default("inside_ctc"),
  countsForPfWage: componentFields.countsForPfWage.default(false),
  countsForEsiWage: componentFields.countsForEsiWage.default(false),
  countsForGratuity: componentFields.countsForGratuity.default(false),
  // omitted => defaultLopApplicable(kind, spec) (owner decision 10 Nov 2026, second set); applied in the create route
  lopApplicable: componentFields.lopApplicable.optional(),
  payslipOrder: componentFields.payslipOrder.optional(),
}).strict();
export type CreateComponentBody = z.infer<typeof createComponentBody>;

/** PATCH: every field optional; the code never changes. `version` is the optimistic-lock token the screen read. */
export const updateComponentBody = z.object({
  name: componentFields.name.optional(),
  componentType: componentFields.componentType.optional(),
  isTaxable: componentFields.isTaxable.optional(),
  calc: componentFields.calc.optional(),
  pctOfBasic: componentFields.pctOfBasic.optional(),
  pctOfCtcBps: componentFields.pctOfCtcBps.optional(),
  fixedMinor: componentFields.fixedMinor.optional(),
  employerCostClass: componentFields.employerCostClass.optional(),
  costPlacement: componentFields.costPlacement.optional(),
  countsForPfWage: componentFields.countsForPfWage.optional(),
  countsForEsiWage: componentFields.countsForEsiWage.optional(),
  countsForGratuity: componentFields.countsForGratuity.optional(),
  lopApplicable: componentFields.lopApplicable.optional(),
  payslipOrder: componentFields.payslipOrder.optional(),
  version: z.number().int().min(1).optional(),
}).strict().refine((b) => Object.keys(b).some((k) => k !== "version"), { message: "nothing to change" });
export type UpdateComponentBody = z.infer<typeof updateComponentBody>;

export const setActiveBody = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const reorderBody = z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(200) }).strict();
export const createTemplateBody = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(500).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;
export const newVersionBody = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type NewVersionBody = z.infer<typeof newVersionBody>;

/** A stored component row, in API shape (fixedMinor is a digit string). */
export interface ComponentRowView {
  id: string; structureId: string; code: string; name: string; componentType: string; isTaxable: boolean;
  isActive: boolean; calc: string | null; pctOfBasic: number | null; pctOfCtcBps: number | null; fixedMinor: string | null;
  employerCostClass: string | null; costPlacement: string; countsForPfWage: boolean; countsForEsiWage: boolean;
  countsForGratuity: boolean; lopApplicable: boolean; payslipOrder: number | null; version: number;
}

/** The calc a legacy row (calc IS NULL) effectively has: the engine's own precedence. */
export function effectiveCalc(r: Pick<ComponentRowView, "calc" | "pctOfBasic" | "fixedMinor">): ComponentCalcType | null {
  if (r.calc) return r.calc as ComponentCalcType;
  if (r.pctOfBasic != null && r.pctOfBasic > 0) return "pct_of_basic";
  if (r.fixedMinor != null) return "fixed";
  return null;
}

export function specFromCreate(b: CreateComponentBody): ComponentSpec {
  const employerCostClass = (b.employerCostClass ?? null) as EmployerCostClass | null;
  return {
    code: b.code, name: b.name,
    componentType: (b.componentType ?? (employerCostClass ? "employer_cost" : "earning")) as ComponentType,
    isTaxable: b.isTaxable,
    calc: (b.calc ?? null) as ComponentCalcType | null,
    pctOfBasic: b.pctOfBasic ?? null, pctOfCtcBps: b.pctOfCtcBps ?? null,
    fixedMinor: b.fixedMinor != null ? BigInt(b.fixedMinor) : null,
    employerCostClass, costPlacement: b.costPlacement as CostPlacement,
    countsForPfWage: b.countsForPfWage, countsForEsiWage: b.countsForEsiWage, countsForGratuity: b.countsForGratuity,
    lopApplicable: b.lopApplicable ?? false, payslipOrder: b.payslipOrder ?? null,
  };
}

/**
 * Merge a PATCH onto the stored row. If `calc` is in the patch the amount fields come ONLY from the patch
 * (changing how a component is calculated clears the old amount); otherwise unspecified fields are kept.
 */
export function specFromUpdate(cur: ComponentRowView, b: UpdateComponentBody): ComponentSpec {
  const calcChanged = b.calc !== undefined;
  const calc = calcChanged ? (b.calc as ComponentCalcType | null) : effectiveCalc(cur);
  const keep = <T,>(patch: T | undefined, old: T): T => (patch !== undefined ? patch : old);
  const employerCostClass = keep(b.employerCostClass as EmployerCostClass | null | undefined, cur.employerCostClass as EmployerCostClass | null);
  return {
    code: cur.code,
    name: keep(b.name, cur.name),
    componentType: keep(b.componentType as ComponentType | undefined, cur.componentType as ComponentType),
    isTaxable: keep(b.isTaxable, cur.isTaxable),
    calc,
    pctOfBasic: calcChanged ? (b.pctOfBasic ?? null) : keep(b.pctOfBasic, cur.pctOfBasic) ?? null,
    pctOfCtcBps: calcChanged ? (b.pctOfCtcBps ?? null) : keep(b.pctOfCtcBps, cur.pctOfCtcBps) ?? null,
    fixedMinor: (() => {
      const v = calcChanged ? (b.fixedMinor ?? null) : keep(b.fixedMinor, cur.fixedMinor);
      return v != null ? BigInt(v) : null;
    })(),
    employerCostClass,
    costPlacement: keep(b.costPlacement as CostPlacement | undefined, cur.costPlacement as CostPlacement),
    countsForPfWage: keep(b.countsForPfWage, cur.countsForPfWage),
    countsForEsiWage: keep(b.countsForEsiWage, cur.countsForEsiWage),
    countsForGratuity: keep(b.countsForGratuity, cur.countsForGratuity),
    lopApplicable: keep(b.lopApplicable, cur.lopApplicable),
    payslipOrder: keep(b.payslipOrder, cur.payslipOrder) ?? null,
  };
}

/** JSON-safe form of a spec (bigint to string) for the queue payload. */
export function specToJson(s: ComponentSpec): Record<string, unknown> {
  return { ...s, fixedMinor: s.fixedMinor != null ? s.fixedMinor.toString() : null };
}
export function specFromJson(j: Record<string, unknown>): ComponentSpec {
  return { ...(j as unknown as ComponentSpec), fixedMinor: j.fixedMinor != null ? BigInt(j.fixedMinor as string) : null };
}
