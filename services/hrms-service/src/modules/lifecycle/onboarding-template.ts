/**
 * Apply an onboarding template to an employee (GAP-HR-ONBOARDING-02).
 *
 *  GET  /v1/hrms/onboarding/templates                    the tenant's templates + the platform default
 *  POST /v1/hrms/employees/:id/onboarding/apply-template create the employee's onboarding tasks from a template
 *
 * Before this there was no way to start onboarding for a joinee: a template
 * could be stored (POST /v1/hrms/onboarding/templates) but nothing turned it
 * into hrms_onboarding_tasks, the only thing the tracker lists.
 *
 * CQRS: the route validates and publishes `hrms.onboarding.apply_template`
 * (202); the consumer inserts the tasks and the audit event in one
 * transaction, serialised per employee by an advisory lock and de-duplicated
 * by title -- so applying the same template twice (a double click, a retried
 * request, two HR officers at once) never creates duplicate tasks.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { idempotentId } from "@civitasone/auth";
import { pino } from "pino";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead, sqlClient } from "../../shared/db.js";
import { queue as sharedQueue } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { isExitedStatus } from "../employee/status.js";
import { hrmsOnboardingTasks } from "./schema.js";

const log = pino({ name: "hrms-onboarding-template" });
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const AUDIT = "audit.event.record";

export interface TemplateStep { title: string; dueByDay: number }

/**
 * Platform default joining checklist, used when no templateId is given.
 * Default policy (VERIFY): the common Government-of-India joining formalities.
 * Tenants override it by storing their own template (POST
 * /v1/hrms/onboarding/templates) and choosing it explicitly.
 */
export const DEFAULT_TEMPLATE_ID = "default";
export const DEFAULT_TEMPLATE_NAME = "Standard joining checklist";
export const DEFAULT_TEMPLATE_STEPS: ReadonlyArray<TemplateStep> = [
  { title: "Submit joining report and take charge", dueByDay: 1 },
  { title: "Verify original documents and certificates", dueByDay: 3 },
  { title: "IT account and official email created", dueByDay: 5 },
  { title: "Issue identity card and building access", dueByDay: 7 },
  { title: "Submit bank, PAN and Aadhaar details for payroll", dueByDay: 7 },
  { title: "Complete police / background verification forms", dueByDay: 7 },
  { title: "Enrol in the pension scheme (NPS PRAN) where applicable", dueByDay: 15 },
  { title: "Attend induction orientation", dueByDay: 14 },
  { title: "Meet the reporting officer and agree the first-90-day plan", dueByDay: 30 },
];

const MAX_TITLE = 200;

/**
 * Turn a stored template's `steps` JSON ([{title, owner?, dueDays?}]) into
 * task rows: trimmed non-empty titles (<= 200), due day clamped to 1..365
 * (default 7 when missing/invalid), duplicates within the template dropped
 * (case-insensitive) so a sloppy template cannot create duplicate tasks.
 */
export function stepsToTasks(raw: unknown): TemplateStep[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TemplateStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const rec = s as { title?: unknown; dueDays?: unknown; dueByDay?: unknown };
    const title = typeof rec.title === "string" ? rec.title.trim().slice(0, MAX_TITLE) : "";
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const d = Number(rec.dueDays ?? rec.dueByDay);
    out.push({ title, dueByDay: Number.isInteger(d) && d >= 1 && d <= 365 ? d : 7 });
  }
  return out;
}

/** Steps not already present for the employee (case-insensitive title match). */
export function stepsToAdd(steps: TemplateStep[], existingTitles: string[]): TemplateStep[] {
  const have = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return steps.filter((s) => !have.has(s.title.toLowerCase()));
}

interface StoredTemplate { id: string; name: string; steps: unknown }

async function listTemplates(tenantId: string): Promise<StoredTemplate[]> {
  // employee.onboarding_templates has FORCE RLS and no Drizzle model: set the
  // tenant GUC the same way gap-features/routes.ts does for this table.
  return (await sqlClient.begin(async (s) => {
    await s.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return s.unsafe(`SELECT id, name, steps FROM employee.onboarding_templates WHERE tenant_id = $1 AND status = 'active' ORDER BY name LIMIT 100`, [tenantId]);
  })) as unknown as StoredTemplate[];
}

const applyBody = z.object({ templateId: z.union([z.literal(DEFAULT_TEMPLATE_ID), z.string().uuid()]).default(DEFAULT_TEMPLATE_ID) });

export async function onboardingTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/onboarding/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await listTemplates(ctx.tenantId);
    return reply.send({
      data: [
        { id: DEFAULT_TEMPLATE_ID, name: DEFAULT_TEMPLATE_NAME, stepCount: DEFAULT_TEMPLATE_STEPS.length, isDefault: true },
        ...rows.map((r) => ({ id: r.id, name: r.name, stepCount: stepsToTasks(r.steps).length, isDefault: false })),
      ],
    });
  });

  app.post("/v1/hrms/employees/:id/onboarding/apply-template", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = applyBody.parse(req.body ?? {});
    const emp = (await scopedRead((tx) => tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.id, id))).limit(1)))[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    if (isExitedStatus(emp.status)) {
      throw new HttpError(409, "EMPLOYEE_EXITED", `employee has status '${emp.status}'; onboarding cannot be started`);
    }
    let name = DEFAULT_TEMPLATE_NAME;
    let steps: TemplateStep[] = [...DEFAULT_TEMPLATE_STEPS];
    if (body.templateId !== DEFAULT_TEMPLATE_ID) {
      const tpl = (await listTemplates(ctx.tenantId)).find((t) => t.id === body.templateId);
      if (!tpl) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "onboarding template not found");
      name = tpl.name;
      steps = stepsToTasks(tpl.steps);
      if (steps.length === 0) throw new HttpError(422, "TEMPLATE_EMPTY", "this template has no usable steps");
    }
    // A client x-idempotency-key makes a retried request one command.
    const messageId = idempotentId({ ...(ctx.idempotencyKey ? { idempotencyKey: `onb.apply:${id}:${ctx.idempotencyKey}` } : {}), tenantId: ctx.tenantId });
    await sharedQueue.publish(COMMANDS.onboardingApplyTemplate, {
      messageId, type: COMMANDS.onboardingApplyTemplate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { employeeId: id, templateId: body.templateId, templateName: name, steps, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ employeeId: id, status: "accepted", stepCount: steps.length, correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

export function registerOnboardingTemplateConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.onboardingApplyTemplate, async (msg) => {
    const p = msg.payload as { employeeId: string; templateId: string; templateName: string; steps: TemplateStep[] };
    if (!Array.isArray(p.steps) || p.steps.length === 0) throw new NonRetryableError("apply-template carries no steps");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Serialise concurrent applications for ONE employee, so the
      // read-existing-then-insert below cannot interleave and double up.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${msg.tenantId}:onboarding:${p.employeeId}`}))`);
      const existing = await tx.select({ title: hrmsOnboardingTasks.title }).from(hrmsOnboardingTasks)
        .where(and(eq(hrmsOnboardingTasks.tenantId, msg.tenantId), eq(hrmsOnboardingTasks.employeeId, p.employeeId)));
      const add = stepsToAdd(stepsToTasks(p.steps), existing.map((e) => e.title));
      if (add.length > 0) {
        await tx.insert(hrmsOnboardingTasks).values(add.map((s) => ({
          id: randomUUID(), tenantId: msg.tenantId, employeeId: p.employeeId,
          title: s.title, dueByDay: s.dueByDay, createdBy: msg.actorId,
        })));
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "apply_template", resourceType: "onboarding", resourceId: p.employeeId, outcome: "success",
          metadata: { templateId: p.templateId, templateName: p.templateName, tasksAdded: add.length, tasksSkipped: p.steps.length - add.length },
        },
      });
    });
    log.info({ messageId: msg.messageId }, "onboarding template applied");
  });
}
