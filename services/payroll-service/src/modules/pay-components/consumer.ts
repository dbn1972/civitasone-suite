/**
 * Applies the G2 pay-component commands. Every handler is idempotent (markProcessed on the messageId),
 * runs in one transaction that locks the structure row FOR UPDATE, re-checks lock / uniqueness / the
 * component and template rules (the route checked them for an immediate answer; this closes the race),
 * and writes one audit event. A refusal is a NonRetryableError carrying the stable code.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import { specFromJson, type ComponentRowView } from "./api.js";
import { validateComponentSpec, type ComponentSpec } from "./model.js";
import { checkStructure, loadComponents, loadStructure, specAsRow, type StructureView } from "./rules.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

const refuse = (code: string, message: string): never => { throw new NonRetryableError(`${code}: ${message}`); };

async function lockedStructure(tx: Tx, msg: Msg, id: string): Promise<StructureView> {
  const s = await loadStructure(tx as never, msg.tenantId, id, true);
  if (!s) return refuse("NOT_FOUND", "structure not found");
  if (s.effectivelyLocked) refuse("STRUCTURE_LOCKED", "this structure is locked or has been used by a payroll run; create a new version to change it");
  return s;
}

async function touchStructure(tx: Tx, msg: Msg, id: string): Promise<void> {
  await tx.execute(sql`UPDATE payroll.payroll_structures SET updated_by = ${msg.actorId}::uuid, updated_at = now(), version = version + 1
                       WHERE id = ${id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
}

function assertSpec(s: StructureView, spec: ComponentSpec, isNew: boolean): void {
  const issues = validateComponentSpec(s.kind, spec, { isNew });
  if (issues.length > 0) refuse(issues[0]!.code, issues[0]!.message);
}

function assertTemplateOk(s: StructureView, comps: ComponentRowView[]): void {
  const { errors } = checkStructure(s.kind, comps);
  if (errors.length > 0) refuse(errors[0]!.code, errors[0]!.message);
}

const auditDetails = (spec: ComponentSpec) => ({
  code: spec.code, name: spec.name, componentType: spec.componentType, calc: spec.calc, pctOfBasic: spec.pctOfBasic,
  pctOfCtcBps: spec.pctOfCtcBps, fixedMinor: spec.fixedMinor?.toString() ?? null, employerCostClass: spec.employerCostClass,
  costPlacement: spec.costPlacement,
});

export function registerPayComponentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.ctcTemplateCreate, async (msg) => {
    const p = msg.payload as { id: string; name: string; description?: string; effectiveFrom?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_structures (id, tenant_id, name, description, is_default, status, kind, effective_from, created_by, updated_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.name}, ${p.description ?? null}, false, 'active', 'ctc_template',
                ${p.effectiveFrom ?? null}::date, ${msg.actorId}::uuid, ${msg.actorId}::uuid)`);
      await audit(tx, msg, "create", "payroll_ctc_template", p.id, { name: p.name, effectiveFrom: p.effectiveFrom ?? null });
    });
  });

  queue.subscribe(COMMANDS.payComponentCreate, async (msg) => {
    const p = msg.payload as { id: string; structureId: string; spec: Record<string, unknown> };
    const spec = specFromJson(p.spec);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const s = await lockedStructure(tx, msg, p.structureId);
      assertSpec(s, spec, true);
      const comps = await loadComponents(tx as never, msg.tenantId, s.id);
      if (comps.some((c) => c.code === spec.code)) refuse("CODE_EXISTS", `component ${spec.code} already exists in this structure`);
      assertTemplateOk(s, [...comps, specAsRow(spec, { id: p.id, structureId: s.id })]);
      await tx.execute(sql`
        INSERT INTO payroll.payroll_components
          (id, tenant_id, structure_id, code, name, component_type, is_taxable, pct_of_basic, fixed_minor, calc, pct_of_ctc_bps,
           employer_cost_class, cost_placement, counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity, lop_applicable,
           payslip_order, is_active, created_by, updated_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${s.id}::uuid, ${spec.code}, ${spec.name}, ${spec.componentType}, ${spec.isTaxable},
           ${spec.pctOfBasic}, ${spec.fixedMinor?.toString() ?? null}::bigint, ${spec.calc}, ${spec.pctOfCtcBps},
           ${spec.employerCostClass}, ${spec.costPlacement}, ${spec.countsForPfWage}, ${spec.countsForEsiWage}, ${spec.countsForGratuity},
           ${spec.lopApplicable},
           COALESCE(${spec.payslipOrder}::smallint, (SELECT COALESCE(MAX(payslip_order), 0) + 10 FROM payroll.payroll_components
                                                      WHERE tenant_id = ${msg.tenantId}::uuid AND structure_id = ${s.id}::uuid)),
           true, ${msg.actorId}::uuid, ${msg.actorId}::uuid)`);
      await touchStructure(tx, msg, s.id);
      await audit(tx, msg, "create", "payroll_component", p.id, { structureId: s.id, ...auditDetails(spec) });
    });
  });

  queue.subscribe(COMMANDS.payComponentUpdate, async (msg) => {
    const p = msg.payload as { id: string; structureId: string; spec: Record<string, unknown>; version: number | null };
    const spec = specFromJson(p.spec);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const s = await lockedStructure(tx, msg, p.structureId);
      const comps = await loadComponents(tx as never, msg.tenantId, s.id);
      const cur = comps.find((c) => c.id === p.id);
      if (!cur) return refuse("NOT_FOUND", "component not found in this structure");
      if (p.version != null && p.version !== cur.version) refuse("VERSION_CONFLICT", "the component was changed by someone else; reload and try again");
      if (spec.code !== cur.code) refuse("CODE_IMMUTABLE", "a component code cannot be changed");
      assertSpec(s, spec, false);
      assertTemplateOk(s, comps.map((c) => (c.id === p.id ? specAsRow(spec, { id: c.id, structureId: s.id, isActive: c.isActive, version: c.version }) : c)));
      await tx.execute(sql`
        UPDATE payroll.payroll_components SET
          name = ${spec.name}, component_type = ${spec.componentType}, is_taxable = ${spec.isTaxable},
          pct_of_basic = ${spec.pctOfBasic}, fixed_minor = ${spec.fixedMinor?.toString() ?? null}::bigint, calc = ${spec.calc},
          pct_of_ctc_bps = ${spec.pctOfCtcBps}, employer_cost_class = ${spec.employerCostClass}, cost_placement = ${spec.costPlacement},
          counts_for_pf_wage = ${spec.countsForPfWage}, counts_for_esi_wage = ${spec.countsForEsiWage},
          counts_for_gratuity = ${spec.countsForGratuity}, lop_applicable = ${spec.lopApplicable},
          payslip_order = COALESCE(${spec.payslipOrder}::smallint, payslip_order),
          updated_by = ${msg.actorId}::uuid, updated_at = now(), version = version + 1
        WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      await touchStructure(tx, msg, s.id);
      await audit(tx, msg, "update", "payroll_component", p.id, {
        structureId: s.id, before: { name: cur.name, calc: cur.calc, pctOfBasic: cur.pctOfBasic, pctOfCtcBps: cur.pctOfCtcBps, fixedMinor: cur.fixedMinor },
        ...auditDetails(spec),
      });
    });
  });

  queue.subscribe(COMMANDS.payComponentSetActive, async (msg) => {
    const p = msg.payload as { id: string; structureId: string; isActive: boolean; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const s = await lockedStructure(tx, msg, p.structureId);
      const comps = await loadComponents(tx as never, msg.tenantId, s.id);
      const cur = comps.find((c) => c.id === p.id);
      if (!cur) return refuse("NOT_FOUND", "component not found in this structure");
      assertTemplateOk(s, comps.map((c) => (c.id === p.id ? { ...c, isActive: p.isActive } : c)));
      await tx.execute(sql`UPDATE payroll.payroll_components SET is_active = ${p.isActive}, updated_by = ${msg.actorId}::uuid,
                           updated_at = now(), version = version + 1 WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      await touchStructure(tx, msg, s.id);
      await audit(tx, msg, p.isActive ? "reactivate" : "deactivate", "payroll_component", p.id, { structureId: s.id, code: cur.code, reason: p.reason });
    });
  });

  queue.subscribe(COMMANDS.payComponentReorder, async (msg) => {
    const p = msg.payload as { structureId: string; orderedIds: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const s = await lockedStructure(tx, msg, p.structureId);
      const comps = await loadComponents(tx as never, msg.tenantId, s.id);
      const known = new Set(comps.map((c) => c.id));
      if (p.orderedIds.some((id) => !known.has(id)) || new Set(p.orderedIds).size !== p.orderedIds.length) {
        refuse("ORDER_INVALID", "the order must list each component of this structure at most once");
      }
      for (const [i, id] of p.orderedIds.entries()) {
        await tx.execute(sql`UPDATE payroll.payroll_components SET payslip_order = ${(i + 1) * 10}, updated_by = ${msg.actorId}::uuid,
                             updated_at = now(), version = version + 1 WHERE id = ${id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      }
      await touchStructure(tx, msg, s.id);
      await audit(tx, msg, "reorder", "payroll_structure", s.id, { orderedIds: p.orderedIds });
    });
  });

  queue.subscribe(COMMANDS.payStructureLock, async (msg) => {
    const p = msg.payload as { structureId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const s = await loadStructure(tx as never, msg.tenantId, p.structureId, true);
      if (!s) return refuse("NOT_FOUND", "structure not found");
      if (s.isLocked) return; // already locked: idempotent
      // Maker-checker on a CTC template (owner decision 1): the person who last changed it cannot lock (approve) it.
      if (s.kind === "ctc_template" && s.updatedBy === msg.actorId) refuse("MAKER_CHECKER_VIOLATION", "a different person must lock (approve) this template");
      const { errors } = checkStructure(s.kind, await loadComponents(tx as never, msg.tenantId, s.id));
      if (errors.length > 0) refuse(errors[0]!.code, errors[0]!.message);
      await tx.execute(sql`UPDATE payroll.payroll_structures SET is_locked = true, locked_at = now(), locked_by = ${msg.actorId}::uuid,
                           version = version + 1 WHERE id = ${s.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
      await audit(tx, msg, "lock", "payroll_structure", s.id, { kind: s.kind, templateVersion: s.templateVersion, madeBy: s.updatedBy });
    });
  });

  queue.subscribe(COMMANDS.payStructureNewVersion, async (msg) => {
    const p = msg.payload as { id: string; sourceId: string; name?: string; effectiveFrom?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const src = await loadStructure(tx as never, msg.tenantId, p.sourceId, true);
      if (!src) return refuse("NOT_FOUND", "structure not found");
      const next = src.templateVersion + 1;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_structures (id, tenant_id, name, description, is_default, status, kind, effective_from,
                                                template_version, parent_structure_id, created_by, updated_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.name ?? `${src.name} v${next}`}, ${src.description}, false, 'active', ${src.kind},
                ${p.effectiveFrom ?? src.effectiveFrom}::date, ${next}, ${src.id}::uuid, ${msg.actorId}::uuid, ${msg.actorId}::uuid)`);
      await tx.execute(sql`
        INSERT INTO payroll.payroll_components
          (id, tenant_id, structure_id, code, name, component_type, is_taxable, formula, pct_of_basic, fixed_minor, currency, calc,
           pct_of_ctc_bps, employer_cost_class, cost_placement, counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity,
           lop_applicable, payslip_order, is_active, created_by, updated_by)
        SELECT gen_random_uuid(), tenant_id, ${p.id}::uuid, code, name, component_type, is_taxable, formula, pct_of_basic, fixed_minor, currency, calc,
               pct_of_ctc_bps, employer_cost_class, cost_placement, counts_for_pf_wage, counts_for_esi_wage, counts_for_gratuity,
               lop_applicable, payslip_order, true, ${msg.actorId}::uuid, ${msg.actorId}::uuid
          FROM payroll.payroll_components
         WHERE tenant_id = ${msg.tenantId}::uuid AND structure_id = ${src.id}::uuid AND is_active`);
      await audit(tx, msg, "new_version", "payroll_structure", p.id, { sourceId: src.id, kind: src.kind, templateVersion: next });
    });
  });
}
