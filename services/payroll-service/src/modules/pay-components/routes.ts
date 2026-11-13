/**
 * Section 8 G2: pay-component master API. All behind S8_PAY_COMPONENTS_ENABLED (default off): with the flag
 * off every route except /meta answers 404 PAY_COMPONENTS_DISABLED and nothing in the run path changes.
 *
 *  GET  /v1/payroll/pay-components/meta                          flag state + the contract enums (always answers)
 *  GET  /v1/payroll/ctc-templates                                CTC templates
 *  POST /v1/payroll/ctc-templates                                create a template (202)
 *  GET  /v1/payroll/structures/:id/components                    structure + all components (incl. inactive) + template check
 *  POST /v1/payroll/structures/:id/components                    add (202)
 *  PATCH /v1/payroll/structures/:id/components/:cid              edit (202)
 *  POST /v1/payroll/structures/:id/components/:cid/deactivate    deactivate, reason required, never deletes (202)
 *  POST /v1/payroll/structures/:id/components/:cid/reactivate    (202)
 *  POST /v1/payroll/structures/:id/components/reorder            payslip order (202)
 *  POST /v1/payroll/structures/:id/lock                          lock (approve) the structure (202)
 *  POST /v1/payroll/structures/:id/new-version                   copy into a new unlocked version (202)
 *
 * Writes are CQRS commands (202) applied by consumer.ts; the checks that give an immediate answer are repeated there.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import {
  createComponentBody, updateComponentBody, setActiveBody, reorderBody, createTemplateBody, newVersionBody,
  specFromCreate, specFromUpdate,
} from "./api.js";
import * as commands from "./commands.js";
import {
  COMPONENT_CALC_TYPES, COMPONENT_TYPES, COST_PLACEMENTS, EMPLOYER_COST_CLASSES, RESERVED_RUN_CODES, RUN_CALC_TYPES,
  STATUTORY_DERIVED_CLASSES, STRUCTURE_KINDS, payComponentsEnabled, validateComponentSpec, type SpecIssue,
} from "./model.js";
import { checkStructure, listTemplates, loadComponents, loadLineage, loadStructure, newVersionRefusal, specAsRow } from "./rules.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];
const WRITE_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const LOCK_ROLES = ["payroll_admin", "super_admin"];
const sidParam = z.object({ id: z.string().uuid() });
const compParam = z.object({ id: z.string().uuid(), cid: z.string().uuid() });

function enabled(): void {
  if (!payComponentsEnabled()) throw new HttpError(404, "PAY_COMPONENTS_DISABLED", "pay components management is not enabled for this deployment");
}
function firstIssue(issues: SpecIssue[]): void {
  const i = issues[0];
  if (i) throw new HttpError(422, i.code, i.message);
}

export async function payComponentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/pay-components/meta", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({
      enabled: payComponentsEnabled(),
      structureKinds: STRUCTURE_KINDS, calcTypes: COMPONENT_CALC_TYPES, componentTypes: COMPONENT_TYPES,
      employerCostClasses: EMPLOYER_COST_CLASSES, statutoryDerivedClasses: STATUTORY_DERIVED_CLASSES,
      costPlacements: COST_PLACEMENTS, runCalcTypes: RUN_CALC_TYPES, reservedRunCodes: RESERVED_RUN_CODES,
    });
  });

  app.get("/v1/payroll/ctc-templates", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await scopedRead((tx) => listTemplates(tx as never, ctx.tenantId));
    return reply.send({
      data: rows.map((r) => ({
        id: r.id, name: r.name, description: r.description ?? null, status: r.status, isLocked: r.is_locked,
        templateVersion: Number(r.template_version), parentStructureId: r.parent_structure_id ?? null,
        effectiveFrom: r.effective_from ?? null, activeComponents: Number(r.active_components),
      })),
      meta: { total: rows.length },
    });
  });

  app.post("/v1/payroll/ctc-templates", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createTemplateBody.parse(req.body);
    return reply.code(202).send(await commands.createTemplate(ctx, body));
  });

  app.get("/v1/payroll/structures/:id/components", async (req, reply) => {
    enabled();
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = sidParam.parse(req.params);
    const out = await scopedRead(async (tx) => {
      const s = await loadStructure(tx as never, ctx.tenantId, id);
      if (!s) throw new HttpError(404, "NOT_FOUND", "structure not found");
      const components = await loadComponents(tx as never, ctx.tenantId, id);
      return { structure: s, components, check: checkStructure(s.kind, components) };
    });
    return reply.send(out);
  });

  /** Shared pre-flight for the component writes: the structure exists and is not locked. */
  async function editable(tenantId: string, id: string) {
    return scopedRead(async (tx) => {
      const s = await loadStructure(tx as never, tenantId, id);
      if (!s) throw new HttpError(404, "NOT_FOUND", "structure not found");
      if (s.effectivelyLocked) throw new HttpError(409, "STRUCTURE_LOCKED", "this structure is locked or has been used by a payroll run; create a new version to change it");
      return { s, components: await loadComponents(tx as never, tenantId, id) };
    });
  }

  app.post("/v1/payroll/structures/:id/components", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = sidParam.parse(req.params);
    const spec = specFromCreate(createComponentBody.parse(req.body));
    const { s, components } = await editable(ctx.tenantId, id);
    firstIssue(validateComponentSpec(s.kind, spec));
    if (components.some((c) => c.code === spec.code)) throw new HttpError(409, "CODE_EXISTS", `component ${spec.code} already exists in this structure`);
    firstIssue(checkStructure(s.kind, [...components, specAsRow(spec, { id: "new", structureId: id })]).errors);
    return reply.code(202).send(await commands.createComponent(ctx, id, spec));
  });

  app.patch("/v1/payroll/structures/:id/components/:cid", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, cid } = compParam.parse(req.params);
    const body = updateComponentBody.parse(req.body);
    const { s, components } = await editable(ctx.tenantId, id);
    const cur = components.find((c) => c.id === cid);
    if (!cur) throw new HttpError(404, "NOT_FOUND", "component not found in this structure");
    if (body.version != null && body.version !== cur.version) throw new HttpError(409, "VERSION_CONFLICT", "the component was changed by someone else; reload and try again");
    const spec = specFromUpdate(cur, body);
    firstIssue(validateComponentSpec(s.kind, spec, { isNew: false }));
    firstIssue(checkStructure(s.kind, components.map((c) => (c.id === cid ? specAsRow(spec, { id: c.id, structureId: id, isActive: c.isActive, version: c.version }) : c))).errors);
    return reply.code(202).send(await commands.updateComponent(ctx, id, cid, spec, body.version));
  });

  for (const [action, isActive] of [["deactivate", false], ["reactivate", true]] as const) {
    app.post(`/v1/payroll/structures/:id/components/:cid/${action}`, async (req, reply) => {
      enabled();
      const ctx = resolveContext(req);
      requireRole(ctx, WRITE_ROLES);
      const { id, cid } = compParam.parse(req.params);
      const { reason } = setActiveBody.parse(req.body);
      const { s, components } = await editable(ctx.tenantId, id);
      if (!components.some((c) => c.id === cid)) throw new HttpError(404, "NOT_FOUND", "component not found in this structure");
      firstIssue(checkStructure(s.kind, components.map((c) => (c.id === cid ? { ...c, isActive } : c))).errors);
      return reply.code(202).send(await commands.setComponentActive(ctx, id, cid, isActive, reason));
    });
  }

  app.post("/v1/payroll/structures/:id/components/reorder", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = sidParam.parse(req.params);
    const { orderedIds } = reorderBody.parse(req.body);
    const { components } = await editable(ctx.tenantId, id);
    const known = new Set(components.map((c) => c.id));
    if (orderedIds.some((x) => !known.has(x)) || new Set(orderedIds).size !== orderedIds.length) {
      throw new HttpError(422, "ORDER_INVALID", "the order must list each component of this structure at most once");
    }
    return reply.code(202).send(await commands.reorderComponents(ctx, id, orderedIds));
  });

  app.post("/v1/payroll/structures/:id/lock", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const { id } = sidParam.parse(req.params);
    const out = await scopedRead(async (tx) => {
      const s = await loadStructure(tx as never, ctx.tenantId, id);
      if (!s) throw new HttpError(404, "NOT_FOUND", "structure not found");
      return { s, check: checkStructure(s.kind, await loadComponents(tx as never, ctx.tenantId, id)) };
    });
    if (out.s.isLocked) throw new HttpError(409, "ALREADY_LOCKED", "this structure is already locked");
    if (out.s.kind === "ctc_template" && out.s.updatedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "a different person must lock (approve) this template");
    }
    firstIssue(out.check.errors);
    return reply.code(202).send(await commands.lockStructure(ctx, id));
  });

  app.post("/v1/payroll/structures/:id/new-version", async (req, reply) => {
    enabled();
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = sidParam.parse(req.params);
    const body = newVersionBody.parse(req.body ?? {});
    const lineage = await scopedRead(async (tx) => {
      const s = await loadStructure(tx as never, ctx.tenantId, id);
      return s ? loadLineage(tx as never, ctx.tenantId, s.lineageRootId) : null;
    });
    if (!lineage) throw new HttpError(404, "NOT_FOUND", "structure not found");
    const refusal = newVersionRefusal(lineage, body.effectiveFrom ?? null);
    if (refusal) throw new HttpError(422, refusal.code, refusal.message);
    return reply.code(202).send(await commands.newStructureVersion(ctx, id, body));
  });
}
