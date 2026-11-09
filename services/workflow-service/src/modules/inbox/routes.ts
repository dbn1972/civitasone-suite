import { isReworkTask } from "../tasks/rework.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { replyIfRateLimited } from "../../shared/rate-limit-error.js";
import { resolvePeople, type Person } from "../../shared/people-client.js";
import { todayIST } from "../../shared/dates.js";
import { TASK_ROUTE_ROLES } from "../tasks/routes.js";
import { FORWARD_ROLES } from "../forwarding/routes.js";
import * as taskRepo from "../tasks/repo.js";
import { isStrictSodRefType } from "../tasks/sod.js";
import * as instanceRepo from "../instances/repo.js";
import * as historyRepo from "../history/repo.js";
import * as delegationRepo from "../delegations/repo.js";
import { INBOX_TABS, inboxCounts, listInbox, countInbox, type InboxTab } from "./repo.js";
import { getRefSummaries, getRefSummariesBatched, MAX_SUMMARY_REFS } from "./summaries.js";

const idParam = z.object({ id: z.string().uuid() });

const inboxQuery = z.object({
  tab: z.enum(INBOX_TABS as [InboxTab, ...InboxTab[]]).default("waiting"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  refType: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).max(20)]).optional(),
  q: z.string().trim().max(100).optional(),
});

const summariesBody = z.object({
  refs: z.array(z.object({ refType: z.string().min(1).max(64), refId: z.string().uuid() })).min(1).max(MAX_SUMMARY_REFS),
});

/** Trail entries an approver reads as file notings: who did what, when, with what remarks. */
const TRAIL_ACTIONS = new Set(["create", "complete", "reject", "return", "forward", "recall"]);

function viewerOf(ctx: { roles: string[]; actorId: string }) {
  return { roles: ctx.roles, actorId: ctx.actorId };
}

/** The caller bearer token, passed on to the owning services so their own scope applies. */
function callerAuthOf(req: { headers: Record<string, unknown> }): string | undefined {
  const h = req.headers.authorization;
  return typeof h === "string" && /^Bearer\s+\S+$/.test(h) ? h : undefined;
}

/** Server search looks at up to this many rows of a tab (module filter applied in SQL first). */
export const SEARCH_CANDIDATES = 1000;

/**
 * UX R1 (approvals inbox -> decide). Read-only endpoints; every decision still goes through the
 * existing POST /v1/workflow/tasks/:id/complete and /forward commands and their server checks.
 */
export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  // One tab of the unified inbox, plus the tab totals (the sidebar badge uses the same counts).
  app.get("/v1/workflow/inbox", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TASK_ROUTE_ROLES);
    const q = inboxQuery.parse(req.query);
    const refTypes = q.refType !== undefined ? (Array.isArray(q.refType) ? q.refType : [q.refType]) : undefined;
    const filter = refTypes ? { refTypes } : {};
    let rows;
    let total: number;
    let searchCapped = false;
    if (q.q) {
      // PR #2460 review: search matches what the row SHOWS (reference, sender name and designation,
      // module facts, workflow names), so it resolves the summaries of the tab candidates first,
      // under the same participant / strict gates, and keeps the module filter.
      const candidates = await listInbox(ctx.tenantId, q.tab, ctx.roles, ctx.actorId, SEARCH_CANDIDATES, 0, filter);
      searchCapped = candidates.length >= SEARCH_CANDIDATES;
      const summaries = await getRefSummariesBatched(ctx.tenantId, viewerOf(ctx),
        candidates.filter((r) => r.refType && r.refId).map((r) => ({ refType: r.refType!, refId: r.refId! })), callerAuthOf(req));
      const byRef = new Map(summaries.map((x) => [`${x.refType}:${x.refId}`, x]));
      const needle = q.q.toLowerCase();
      const matched = candidates.filter((r) => {
        const x = r.refType && r.refId ? byRef.get(`${r.refType}:${r.refId}`) : undefined;
        return [r.instanceName, r.name, x?.reference, x?.maker?.name, x?.maker?.designation, ...(x?.fields ?? []).map((f) => f.value)]
          .some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
      });
      total = matched.length;
      rows = matched.slice(q.offset, q.offset + q.limit);
    } else {
      [rows, total] = await Promise.all([
        listInbox(ctx.tenantId, q.tab, ctx.roles, ctx.actorId, q.limit, q.offset, filter),
        countInbox(ctx.tenantId, q.tab, ctx.roles, ctx.actorId, filter),
      ]);
    }
    const counts = await inboxCounts(ctx.tenantId, ctx.roles, ctx.actorId);
    return reply.send({
      data: rows,
      pagination: { total, pageSize: q.limit, hasMore: q.offset + rows.length < total, ...(searchCapped ? { searchCapped: true } : {}) },
      counts,
    });
  });

  app.get("/v1/workflow/inbox/counts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TASK_ROUTE_ROLES);
    return reply.send({ data: await inboxCounts(ctx.tenantId, ctx.roles, ctx.actorId) });
  });

  // Business context for a batch of refs across modules (participant-scoped, batched, cached).
  // POST only because the ref list is a body; it changes nothing.
  app.post("/v1/workflow/ref-summaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TASK_ROUTE_ROLES);
    const body = summariesBody.parse(req.body ?? {});
    return reply.send({ data: await getRefSummaries(ctx.tenantId, viewerOf(ctx), body.refs, callerAuthOf(req)) });
  });

  // Everything the decision panel needs for one task, for its participants only (404 otherwise).
  app.get("/v1/workflow/inbox/tasks/:id/context", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TASK_ROUTE_ROLES);
    const { id } = idParam.parse(req.params);
    const task = await taskRepo.findById(id, ctx.tenantId);
    if (!task || !(await taskRepo.canViewInstance(ctx.tenantId, task.instanceId, ctx.roles, ctx.actorId))) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }
    const [instance, history, steps, delegations] = await Promise.all([
      instanceRepo.findByIdFull(task.instanceId, ctx.tenantId),
      historyRepo.listForInstance(task.instanceId, ctx.tenantId),
      taskRepo.listByInstance(ctx.tenantId, task.instanceId, 100, 0),
      delegationRepo.activeForDelegate(ctx.tenantId, ctx.actorId, todayIST()),
    ]);
    if (!instance) throw new HttpError(404, "NOT_FOUND", "task not found");
    const stepName = new Map<string, string>();
    for (const s of steps) if (s.nodeKey && !stepName.has(s.nodeKey)) stepName.set(s.nodeKey, s.name);
    const trailRows = history.filter((h) => TRAIL_ACTIONS.has(h.action));
    const people = await resolvePeople(ctx.tenantId, [
      instance.createdBy,
      ...(task.assigneeId ? [task.assigneeId] : []),
      ...trailRows.map((h) => h.actorId),
    ], fetch, callerAuthOf(req));
    const person = (pid: string | null | undefined): Person | null => (pid ? people.get(pid) ?? null : null);
    const summary = task.refType && task.refId
      ? (await getRefSummaries(ctx.tenantId, viewerOf(ctx), [{ refType: task.refType, refId: task.refId }], callerAuthOf(req)))[0] ?? null
      : null;

    // Can this caller decide? Mirrors the completeTask pre-checks (tasks/commands.ts) for the UI
    // only; the server re-checks every one of them on /complete and stays the authority.
    const isSuperAdmin = ctx.roles.includes("super_admin");
    const isAdmin = isSuperAdmin || ctx.roles.includes("workflow_admin");
    const pending = task.status === "pending" && !task.isCall;
    const delegatedFromAssignee = !!task.assigneeId && delegations.some((d) => d.delegatorId === task.assigneeId);
    const holdsRole = task.roleRef
      ? isSuperAdmin || ctx.roles.includes(task.roleRef) || delegations.length > 0
      : isAdmin || task.assigneeId === ctx.actorId || delegatedFromAssignee;
    const assigneeOk = !task.assigneeId || task.assigneeId === ctx.actorId || isAdmin || delegatedFromAssignee;
    const isMaker = instance.createdBy === ctx.actorId || delegations.some((d) => d.delegatorId === instance.createdBy);
    const repeatActor = steps.some((s) => s.status === "completed" && s.id !== task.id
      && history.some((h) => h.taskId === s.id && h.actorId === ctx.actorId && (h.action === "complete" || h.action === "reject" || (h.action === "return" && s.nodeKey !== task.nodeKey))));
    const strict = isStrictSodRefType(instance.refType ?? task.refType);
    // W4: the maker's "correct and resubmit" task is not a checker decision; no maker-checker block applies.
    const isRework = isReworkTask(task, instance);
    const sodBlock: "maker" | "repeatActor" | null = isRework ? null : isMaker && (!isSuperAdmin || strict)
      ? "maker"
      : repeatActor && !isSuperAdmin ? "repeatActor" : null;
    const blockedReason: "notPending" | "assignedToOther" | "notYourRole" | null = !pending
      ? "notPending"
      : !assigneeOk ? "assignedToOther" : !holdsRole ? "notYourRole" : null;
    const canAct = blockedReason === null;

    return reply.send({
      data: {
        task: {
          id: task.id,
          name: task.name,
          status: task.status,
          decision: task.decision ?? null,
          refType: task.refType ?? null,
          refId: task.refId ?? null,
          instanceId: task.instanceId,
          dueAt: task.dueAt ?? null,
          createdAt: task.createdAt ?? null,
          assignee: person(task.assigneeId),
          assigned: !!task.assigneeId,
        },
        instance: {
          id: instance.id,
          name: instance.name,
          status: instance.status,
          createdAt: instance.createdAt instanceof Date ? instance.createdAt.toISOString() : String(instance.createdAt),
        },
        maker: person(instance.createdBy),
        isMaker,
        summary,
        trail: trailRows.map((h) => {
          const detail = (h.detail ?? {}) as Record<string, unknown>;
          const remarks = typeof detail.reason === "string" ? detail.reason : typeof detail.remarks === "string" ? detail.remarks : null;
          return {
            action: h.action,
            decision: h.decision ?? null,
            step: (h.fromNode && stepName.get(h.fromNode)) || null,
            actor: person(h.actorId),
            remarks,
            at: h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt),
          };
        }),
        permissions: {
          canAct,
          blockedReason,
          sodBlock,
          canForward: canAct && sodBlock === null && ctx.roles.some((r) => FORWARD_ROLES.includes(r)),
        },
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const rateLimited = replyIfRateLimited(err, req, reply);
    if (rateLimited) return rateLimited;
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
