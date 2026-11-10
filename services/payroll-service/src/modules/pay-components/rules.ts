/** Reads for the G2 pay-component API / consumer. Callers run these inside scopedRead or a tenant transaction (FORCE RLS). */
import { sql } from "drizzle-orm";
import type { ComponentRowView } from "./api.js";
import { checkTemplate, type ComponentSpec, type StructureKind, type TemplateLine } from "./model.js";

type Tx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const rows = <T,>(r: unknown): T[] => Array.from(r as Iterable<T>);

export interface StructureView {
  id: string; name: string; description: string | null; kind: StructureKind; status: string; isDefault: boolean;
  isLocked: boolean; /** locked explicitly OR referenced by a run past draft/failed */ effectivelyLocked: boolean;
  effectiveFrom: string | null; templateVersion: number; parentStructureId: string | null; updatedBy: string; version: number;
}

/** A run that reads the structure and got past draft/failed makes the structure immutable (use new-version). */
export const RUN_LOCKING_EXCLUDED_STATUSES = ["draft", "failed"] as const;

export async function loadStructure(tx: Tx, tenantId: string, id: string, forUpdate = false): Promise<StructureView | null> {
  const r = rows<Record<string, unknown>>(await tx.execute(sql`
    SELECT s.id, s.name, s.description, s.kind, s.status, s.is_default, s.is_locked,
           to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, s.template_version, s.parent_structure_id,
           s.updated_by, s.version,
           EXISTS (SELECT 1 FROM payroll.payroll_runs r
                    WHERE r.tenant_id = s.tenant_id AND r.structure_id = s.id
                      AND r.status NOT IN ('draft', 'failed')) AS referenced
      FROM payroll.payroll_structures s
     WHERE s.id = ${id}::uuid AND s.tenant_id = ${tenantId}::uuid
     ${forUpdate ? sql`FOR UPDATE OF s` : sql``}`));
  const s = r[0];
  if (!s) return null;
  return {
    id: s.id as string, name: s.name as string, description: (s.description as string | null) ?? null,
    kind: s.kind as StructureKind, status: s.status as string, isDefault: s.is_default as boolean,
    isLocked: s.is_locked as boolean, effectivelyLocked: (s.is_locked as boolean) || (s.referenced as boolean),
    effectiveFrom: (s.effective_from as string | null) ?? null, templateVersion: Number(s.template_version),
    parentStructureId: (s.parent_structure_id as string | null) ?? null, updatedBy: s.updated_by as string, version: Number(s.version),
  };
}

export async function loadComponents(tx: Tx, tenantId: string, structureId: string): Promise<ComponentRowView[]> {
  const r = rows<Record<string, unknown>>(await tx.execute(sql`
    SELECT id, structure_id, code, name, component_type, is_taxable, is_active, calc, pct_of_basic::float8 AS pct_of_basic,
           pct_of_ctc_bps, fixed_minor::text AS fixed_minor, employer_cost_class, cost_placement,
           counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity, lop_applicable, payslip_order, version
      FROM payroll.payroll_components
     WHERE tenant_id = ${tenantId}::uuid AND structure_id = ${structureId}::uuid
     ORDER BY payslip_order NULLS LAST, created_at, code`));
  return r.map((c) => ({
    id: c.id as string, structureId: c.structure_id as string, code: c.code as string, name: c.name as string,
    componentType: c.component_type as string, isTaxable: c.is_taxable as boolean, isActive: c.is_active as boolean,
    calc: (c.calc as string | null) ?? null, pctOfBasic: c.pct_of_basic != null ? Number(c.pct_of_basic) : null,
    pctOfCtcBps: c.pct_of_ctc_bps != null ? Number(c.pct_of_ctc_bps) : null, fixedMinor: (c.fixed_minor as string | null) ?? null,
    employerCostClass: (c.employer_cost_class as string | null) ?? null, costPlacement: c.cost_placement as string,
    countsForPfWage: c.counts_for_pf_wage as boolean, countsForEsiWage: c.counts_for_esi_wage as boolean,
    countsForGratuity: c.counts_for_gratuity as boolean, lopApplicable: c.lop_applicable as boolean,
    payslipOrder: c.payslip_order != null ? Number(c.payslip_order) : null, version: Number(c.version),
  }));
}

export function toTemplateLines(components: ComponentRowView[]): TemplateLine[] {
  return components.map((c) => ({
    code: c.code, calc: (c.calc as TemplateLine["calc"]) ?? null, pctOfCtcBps: c.pctOfCtcBps, isActive: c.isActive,
    employerCostClass: (c.employerCostClass as TemplateLine["employerCostClass"]) ?? null,
  }));
}

/** Template checks apply to ctc_template structures only; a run structure has none. */
export function checkStructure(kind: StructureKind, components: ComponentRowView[]) {
  return kind === "ctc_template" ? checkTemplate(toTemplateLines(components)) : { errors: [], warnings: [] };
}

export async function listTemplates(tx: Tx, tenantId: string) {
  return rows<Record<string, unknown>>(await tx.execute(sql`
    SELECT s.id, s.name, s.description, s.status, s.is_locked, s.template_version, s.parent_structure_id,
           to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from,
           (SELECT count(*) FROM payroll.payroll_components c
             WHERE c.structure_id = s.id AND c.tenant_id = s.tenant_id AND c.is_active)::int AS active_components
      FROM payroll.payroll_structures s
     WHERE s.tenant_id = ${tenantId}::uuid AND s.kind = 'ctc_template'
     ORDER BY s.name, s.template_version DESC`));
}

/** A spec as a (not yet stored) component row, for the template checks. */
export const specAsRow = (spec: ComponentSpec, base: Partial<ComponentRowView> & { id: string; structureId: string }): ComponentRowView => ({
  name: spec.name, code: spec.code, componentType: spec.componentType, isTaxable: spec.isTaxable, isActive: true,
  calc: spec.calc, pctOfBasic: spec.pctOfBasic, pctOfCtcBps: spec.pctOfCtcBps, fixedMinor: spec.fixedMinor?.toString() ?? null,
  employerCostClass: spec.employerCostClass, costPlacement: spec.costPlacement, countsForPfWage: spec.countsForPfWage,
  countsForEsiWage: spec.countsForEsiWage, countsForGratuity: spec.countsForGratuity, lopApplicable: spec.lopApplicable,
  payslipOrder: spec.payslipOrder, version: 1, ...base,
});

