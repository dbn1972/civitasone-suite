/**
 * visitor-service: badge-print command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md). Each function publishes a command envelope to SQS/RabbitMQ;
 * the consumer (./consumer.ts) performs the durable write + outbox event.
 *
 * Requirements validated: 5.1, 5.2, 5.3, 5.5, 5.6, 5.8, 5.10, 11.2
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── Payload input types ───────────────────────────────────────────────────

export interface PrintJobCreateInput {
  passId: string;
  deviceId: string;
  priority?: "standard" | "high";
  printerLanguage?: "zpl" | "escpos";
  visitorCategory?: string;
}

export interface PrintJobAcknowledgeInput {
  jobId: string;
  deviceId: string;
}

export interface PrintJobFailInput {
  jobId: string;
  deviceId: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface PrintJobRetryInput {
  jobId: string;
  deviceId: string;
}

export interface PrintJobRequeueInput {
  jobId: string;
  deviceId: string;
  reason?: string;
}

export interface BadgeTemplateCreateInput {
  name: string;
  printerLanguage: "zpl" | "escpos";
  templateBody: string;
  badgeWidthMm?: number;
  badgeHeightMm?: number;
  visitorCategory?: string;
}

export interface BadgeTemplateUpdateInput {
  templateId: string;
  name?: string;
  templateBody?: string;
  badgeWidthMm?: number;
  badgeHeightMm?: number;
  visitorCategory?: string;
}

// ── Command publishers ────────────────────────────────────────────────────

/** Create a print job — renders a badge template and enqueues to the device's print queue. */
export async function publishPrintJobCreate(ctx: RequestContext, input: PrintJobCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.printJobCreate, {
    messageId: id,
    type: COMMANDS.printJobCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      passId: input.passId,
      deviceId: input.deviceId,
      priority: input.priority ?? "standard",
      printerLanguage: input.printerLanguage ?? "zpl",
      visitorCategory: input.visitorCategory ?? "default",
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Acknowledge a print job as completed by the device. */
export async function publishPrintJobAcknowledge(ctx: RequestContext, input: PrintJobAcknowledgeInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.printJobAcknowledge, {
    messageId,
    type: COMMANDS.printJobAcknowledge,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      jobId: input.jobId,
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
    },
  });
  return { id: input.jobId, status: "accepted", correlationId: ctx.correlationId };
}

/** Report a print job failure from the device. */
export async function publishPrintJobFail(ctx: RequestContext, input: PrintJobFailInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.printJobFail, {
    messageId,
    type: COMMANDS.printJobFail,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      jobId: input.jobId,
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    },
  });
  return { id: input.jobId, status: "accepted", correlationId: ctx.correlationId };
}

/** Retry a failed print job (re-enqueue to the device's print queue). */
export async function publishPrintJobRetry(ctx: RequestContext, input: PrintJobRetryInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.printJobRetry, {
    messageId,
    type: COMMANDS.printJobRetry,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      jobId: input.jobId,
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
    },
  });
  return { id: input.jobId, status: "accepted", correlationId: ctx.correlationId };
}

/** Requeue a print job to a (potentially different) device's print queue. */
export async function publishPrintJobRequeue(ctx: RequestContext, input: PrintJobRequeueInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.printJobRequeue, {
    messageId,
    type: COMMANDS.printJobRequeue,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      jobId: input.jobId,
      deviceId: input.deviceId,
      tenantId: ctx.tenantId,
      reason: input.reason ?? null,
    },
  });
  return { id: input.jobId, status: "accepted", correlationId: ctx.correlationId };
}

/** Create a new badge template for a specific printer language and visitor category. */
export async function publishBadgeTemplateCreate(ctx: RequestContext, input: BadgeTemplateCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.badgeTemplateCreate, {
    messageId: id,
    type: COMMANDS.badgeTemplateCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      printerLanguage: input.printerLanguage,
      templateBody: input.templateBody,
      badgeWidthMm: input.badgeWidthMm ?? 54,
      badgeHeightMm: input.badgeHeightMm ?? 86,
      visitorCategory: input.visitorCategory ?? "default",
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Update an existing badge template (creates a new version, archives previous). */
export async function publishBadgeTemplateUpdate(ctx: RequestContext, input: BadgeTemplateUpdateInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.badgeTemplateUpdate, {
    messageId,
    type: COMMANDS.badgeTemplateUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      templateId: input.templateId,
      tenantId: ctx.tenantId,
      name: input.name ?? null,
      templateBody: input.templateBody ?? null,
      badgeWidthMm: input.badgeWidthMm ?? null,
      badgeHeightMm: input.badgeHeightMm ?? null,
      visitorCategory: input.visitorCategory ?? null,
    },
  });
  return { id: input.templateId, status: "accepted", correlationId: ctx.correlationId };
}
