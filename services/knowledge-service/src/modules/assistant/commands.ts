import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, type DrizzleTx } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import { normalizeSteps, type Citation } from "./domain.js";
import { answerQuestion } from "./grounded.js";
import * as repo from "./repo.js";
import type {
  CreateFaqBody,
  UpdateFaqBody,
  CreateFlowBody,
  UpdateFlowBody,
  AskBody,
  EscalateBody,
} from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";
const HELPDESK_CREATE_TICKET = "helpdesk.ticket.create";
const FAQ_RESOURCE = "faq";
const FLOW_RESOURCE = "guided_flow";

export type Accepted = { id: string; status: string; correlationId: string };

/** Run a write transaction with the tenant GUC set from the JWT-derived context. */
function txScoped<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, () => db.transaction(fn as never))) as Promise<T>;
}

export interface AskResult {
  interactionId: string;
  answer: string;
  citations: Citation[];
  answered: boolean;
  grounded: boolean;
  correlationId: string;
}

async function audit(
  tx: DrizzleTx, ctx: RequestContext, action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "knowledge", action, resourceType, resourceId, outcome: "success" },
  });
}

// ── FAQ CRUD ────────────────────────────────────────────────────────
export async function createFaq(ctx: RequestContext, body: CreateFaqBody): Promise<Accepted> {
  const id = randomUUID();
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.insertFaq(tx as unknown as repo.Writer, {
      id, tenantId: ctx.tenantId, question: body.question, answer: body.answer,
      category: body.category ?? null, tags: body.tags, status: body.status,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx as unknown as DrizzleTx, ctx, "create", "faq", id);
  });
  await cache.invalidateResource(ctx.tenantId, FAQ_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateFaq(ctx: RequestContext, id: string, body: UpdateFaqBody): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.updateFaq(tx as unknown as repo.Writer, id, {
      ...(body.question !== undefined ? { question: body.question } : {}),
      ...(body.answer !== undefined ? { answer: body.answer } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      updatedBy: ctx.actorId, updatedAt: new Date(),
    });
    await audit(tx as unknown as DrizzleTx, ctx, "update", "faq", id);
  });
  await cache.invalidateResource(ctx.tenantId, FAQ_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteFaq(ctx: RequestContext, id: string): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.deleteFaq(tx as unknown as repo.Writer, id);
    await audit(tx as unknown as DrizzleTx, ctx, "delete", "faq", id);
  });
  await cache.invalidateResource(ctx.tenantId, FAQ_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── Guided flows ────────────────────────────────────────────────────
export async function createFlow(ctx: RequestContext, body: CreateFlowBody): Promise<Accepted> {
  const id = randomUUID();
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.insertFlow(tx as unknown as repo.Writer, {
      id, tenantId: ctx.tenantId, title: body.title, description: body.description ?? null,
      category: body.category ?? null, steps: normalizeSteps(body.steps), status: body.status,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx as unknown as DrizzleTx, ctx, "create", "guided_flow", id);
  });
  await cache.invalidateResource(ctx.tenantId, FLOW_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateFlow(ctx: RequestContext, id: string, body: UpdateFlowBody): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.updateFlow(tx as unknown as repo.Writer, id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.steps !== undefined ? { steps: normalizeSteps(body.steps) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      updatedBy: ctx.actorId, updatedAt: new Date(),
    });
    await audit(tx as unknown as DrizzleTx, ctx, "update", "guided_flow", id);
  });
  await cache.invalidateResource(ctx.tenantId, FLOW_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── Grounded assistant ──────────────────────────────────────────────
export async function ask(ctx: RequestContext, body: AskBody): Promise<AskResult> {
  const result = await answerQuestion(ctx.tenantId, body.question);
  const interactionId = randomUUID();
  await txScoped(ctx.tenantId, async (tx) => {
    await repo.insertInteraction(tx as unknown as repo.Writer, {
      id: interactionId, tenantId: ctx.tenantId, question: body.question,
      answer: result.answer || null, answered: result.answered, escalated: false,
      citations: result.citations, createdBy: ctx.actorId,
    });
    await enqueue(tx as unknown as DrizzleTx, {
      topic: EVENTS.assistantAnswered, eventType: EVENTS.assistantAnswered,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { interactionId, answered: result.answered, citationCount: result.citations.length },
    });
  });
  return {
    interactionId,
    answer: result.answer,
    citations: result.citations,
    answered: result.answered,
    grounded: result.grounded,
    correlationId: ctx.correlationId,
  };
}

// ── Escalate-to-ticket handoff → helpdesk-service ───────────────────
export async function escalate(ctx: RequestContext, body: EscalateBody): Promise<Accepted> {
  const ticketRef = randomUUID();
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    if (body.interactionId) {
      await repo.markEscalated(tx as unknown as repo.Writer, body.interactionId, ticketRef);
    } else {
      await repo.insertInteraction(tx as unknown as repo.Writer, {
        id: randomUUID(), tenantId: ctx.tenantId, question: body.question,
        answer: null, answered: false, escalated: true, citations: [], ticketRef,
        createdBy: ctx.actorId,
      });
    }
    // Outbox command → helpdesk opens a ticket.
    await enqueue(t, {
      topic: HELPDESK_CREATE_TICKET, eventType: HELPDESK_CREATE_TICKET,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: {
        subject: body.question.slice(0, 200),
        description: body.detail ?? body.question,
        priority: body.priority,
        source: "knowledge_assistant",
        externalRef: ticketRef,
      },
    });
    await enqueue(t, {
      topic: EVENTS.assistantEscalated, eventType: EVENTS.assistantEscalated,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { ticketRef, interactionId: body.interactionId ?? null },
    });
    await audit(t, ctx, "escalate", "assistant", ticketRef);
  });
  return { id: ticketRef, status: "accepted", correlationId: ctx.correlationId };
}
