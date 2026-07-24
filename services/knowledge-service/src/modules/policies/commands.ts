import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, type DrizzleTx } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import {
  assertTransition,
  assertApproverDistinct,
  computeReviewDueDate,
  LifecycleError,
  type PolicyStatus,
} from "./domain.js";
import { policyDocuments, type PolicyRow } from "./schema.js";
import * as repo from "./repo.js";
import type {
  CreatePolicyBody,
  SubmitPolicyBody,
  PublishPolicyBody,
  AcknowledgePolicyBody,
} from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.send";
const RESOURCE = "policy";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Run a write transaction with the tenant GUC set from the JWT-derived context.
 * The onRequest tx-hook only seeds the GUC from an `x-tenant-id` header; wrapping
 * in runWithTenant guarantees RLS is enforced regardless of transport.
 */
function txScoped<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, () => db.transaction(fn as never))) as Promise<T>;
}

async function audit(
  tx: DrizzleTx,
  ctx: RequestContext,
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: { service: "knowledge", action, resourceType: "policy", resourceId, outcome: "success" },
  });
}

async function loadForUpdate(tx: DrizzleTx, tenantId: string, id: string): Promise<PolicyRow> {
  const rows = await tx.select().from(policyDocuments)
    .where(and(eq(policyDocuments.id, id), eq(policyDocuments.tenantId, tenantId)));
  const row = rows[0] as PolicyRow | undefined;
  if (!row) throw new LifecycleError("NOT_FOUND", "policy not found");
  return row;
}

export async function createPolicy(ctx: RequestContext, body: CreatePolicyBody): Promise<Accepted> {
  const id = randomUUID();
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    await repo.insert(tx as unknown as repo.Writer, {
      id,
      tenantId: ctx.tenantId,
      docType: body.docType,
      referenceNo: body.referenceNo ?? null,
      title: body.title,
      body: body.body,
      status: "draft",
      authorId: ctx.actorId,
      reviewDueDate: body.reviewDueDate ?? null,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });
    await enqueue(t, {
      topic: EVENTS.policyCreated, eventType: EVENTS.policyCreated,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id, docType: body.docType, title: body.title },
    });
    await audit(t, ctx, "create", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitForReview(
  ctx: RequestContext, id: string, body: SubmitPolicyBody,
): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    assertTransition(row.status as PolicyStatus, "under_review");
    await repo.update(tx as unknown as repo.Writer, id, {
      status: "under_review",
      reviewerId: body.reviewerId ?? row.reviewerId ?? null,
      updatedBy: ctx.actorId,
      updatedAt: new Date(),
    });
    await enqueue(t, {
      topic: EVENTS.policySubmitted, eventType: EVENTS.policySubmitted,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id },
    });
    await audit(t, ctx, "submit", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approvePolicy(ctx: RequestContext, id: string): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    assertTransition(row.status as PolicyStatus, "approved");
    // Maker-checker: approver must differ from the author.
    assertApproverDistinct(row.authorId, ctx.actorId);
    await repo.update(tx as unknown as repo.Writer, id, {
      status: "approved",
      approverId: ctx.actorId,
      updatedBy: ctx.actorId,
      updatedAt: new Date(),
    });
    await enqueue(t, {
      topic: EVENTS.policyApproved, eventType: EVENTS.policyApproved,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id, approverId: ctx.actorId },
    });
    await audit(t, ctx, "approve", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishPolicy(
  ctx: RequestContext, id: string, body: PublishPolicyBody,
): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    assertTransition(row.status as PolicyStatus, "published");
    // Maker-checker also holds at publish: the publisher must not be the author.
    assertApproverDistinct(row.authorId, ctx.actorId);

    const effectiveDate = body.effectiveDate ?? new Date().toISOString().slice(0, 10);
    const reviewDueDate =
      body.reviewDueDate ??
      (body.reviewMonths ? computeReviewDueDate(effectiveDate, body.reviewMonths) : row.reviewDueDate ?? null);

    await repo.update(tx as unknown as repo.Writer, id, {
      status: "published",
      effectiveDate,
      reviewDueDate,
      publishedAt: new Date(),
      updatedBy: ctx.actorId,
      updatedAt: new Date(),
    });

    // Publishing a new version supersedes the referenced predecessor.
    if (body.supersedesId) {
      const prev = await loadForUpdate(t, ctx.tenantId, body.supersedesId);
      assertTransition(prev.status as PolicyStatus, "superseded");
      await repo.update(tx as unknown as repo.Writer, body.supersedesId, {
        status: "superseded", updatedBy: ctx.actorId, updatedAt: new Date(),
      });
      await repo.update(tx as unknown as repo.Writer, id, { supersedesId: body.supersedesId });
      await enqueue(t, {
        topic: EVENTS.policySuperseded, eventType: EVENTS.policySuperseded,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { policyId: body.supersedesId, supersededById: id },
      });
    }

    await enqueue(t, {
      topic: EVENTS.policyPublished, eventType: EVENTS.policyPublished,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id, title: row.title, docType: row.docType, effectiveDate },
    });

    // Auto-notify affected users → notification-service.
    for (const userId of body.notifyUserIds) {
      await enqueue(t, {
        topic: NOTIFICATION_TOPIC, eventType: NOTIFICATION_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          channel: "in_app",
          recipient: userId,
          subject: `New ${row.docType} published: ${row.title}`,
          body: `A new ${row.docType} "${row.title}" is effective ${effectiveDate}. Please read and acknowledge.`,
          meta: { policyId: id, requiresAcknowledgement: true },
        },
      });
    }
    await audit(t, ctx, "publish", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function supersedePolicy(ctx: RequestContext, id: string): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    assertTransition(row.status as PolicyStatus, "superseded");
    await repo.update(tx as unknown as repo.Writer, id, {
      status: "superseded", updatedBy: ctx.actorId, updatedAt: new Date(),
    });
    await enqueue(t, {
      topic: EVENTS.policySuperseded, eventType: EVENTS.policySuperseded,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id },
    });
    await audit(t, ctx, "supersede", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function withdrawPolicy(ctx: RequestContext, id: string): Promise<Accepted> {
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    assertTransition(row.status as PolicyStatus, "withdrawn");
    await repo.update(tx as unknown as repo.Writer, id, {
      status: "withdrawn", updatedBy: ctx.actorId, updatedAt: new Date(),
    });
    await enqueue(t, {
      topic: EVENTS.policyWithdrawn, eventType: EVENTS.policyWithdrawn,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id },
    });
    await audit(t, ctx, "withdraw", id);
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function acknowledgePolicy(
  ctx: RequestContext, id: string, body: AcknowledgePolicyBody,
): Promise<Accepted> {
  const employeeId = body.employeeId ?? ctx.actorId;
  await txScoped(ctx.tenantId, async (tx) => {
    const t = tx as unknown as DrizzleTx;
    const row = await loadForUpdate(t, ctx.tenantId, id);
    if (row.status !== "published") {
      throw new LifecycleError("INVALID_STATE", "can only acknowledge a published document");
    }
    await repo.insertAck(tx as unknown as repo.Writer, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      policyId: id,
      employeeId,
      note: body.note ?? null,
    });
    await enqueue(t, {
      topic: EVENTS.policyAcknowledged, eventType: EVENTS.policyAcknowledged,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { policyId: id, employeeId },
    });
    await audit(t, ctx, "acknowledge", id);
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
