/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTemplateBody, UpdateTemplateBody, ExecuteTemplateBody } from "./validators.js";
import type { TemplateView } from "./schema.js";
import type { TemplateFilter, TemplateGroup, TemplateAggregation, TemplateParameter } from "./schema.js";
import { validateTemplate, validateTemplateCount } from "./domain.js";
import { HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "template";

export async function createTemplate(ctx: RequestContext, body: CreateTemplateBody): Promise<Accepted> {
  // Validate domain constraints
  const errors = validateTemplate({
    dataSourceId: body.dataSourceId,
    filters: body.filters as TemplateFilter[],
    groups: body.groups as unknown as TemplateGroup[],
    parameters: body.parameters as unknown as TemplateParameter[],
  });
  if (errors.length > 0) {
    throw new HttpError(422, "VALIDATION_FAILED", errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  }

  // Check tenant template limit
  const count = await queries.getTemplateCount(ctx.tenantId);
  const countErr = validateTemplateCount(count);
  if (countErr) {
    throw new HttpError(422, "LIMIT_EXCEEDED", countErr.message);
  }

  const id = randomUUID();
  const projected: TemplateView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    description: body.description ?? null,
    dataSourceId: body.dataSourceId,
    filters: body.filters as TemplateFilter[],
    groups: body.groups as unknown as TemplateGroup[],
    aggregations: body.aggregations as unknown as TemplateAggregation[],
    parameters: body.parameters as unknown as TemplateParameter[],
    outputFormat: body.outputFormat,
    status: "draft",
    watermark: body.watermark ?? null,
    piiColumns: body.piiColumns ?? null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createTemplate, {
    messageId: id,
    type: COMMANDS.createTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTemplate(ctx: RequestContext, id: string, body: UpdateTemplateBody): Promise<Accepted> {
  // Fetch existing template to verify it exists and check version
  const existing = await queries.getTemplate(ctx.tenantId, id);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }
  if (existing.status === "archived") {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }

  // Optimistic locking: version must match
  if (existing.version !== body.version) {
    throw new HttpError(409, "CONFLICT", "template has been modified by another user");
  }

  // Validate domain constraints on the merged values
  const mergedFilters = (body.filters ?? existing.filters) as TemplateFilter[];
  const mergedGroups = (body.groups ?? existing.groups) as unknown as TemplateGroup[];
  const mergedParams = (body.parameters ?? existing.parameters) as unknown as TemplateParameter[];
  const mergedDataSource = body.dataSourceId ?? existing.dataSourceId;

  const errors = validateTemplate({
    dataSourceId: mergedDataSource,
    filters: mergedFilters,
    groups: mergedGroups,
    parameters: mergedParams,
  });
  if (errors.length > 0) {
    throw new HttpError(422, "VALIDATION_FAILED", errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  }

  const messageId = randomUUID();

  await queue.publish(COMMANDS.updateTemplate, {
    messageId,
    type: COMMANDS.updateTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  // Invalidate cache
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteTemplate(ctx: RequestContext, id: string): Promise<Accepted> {
  const existing = await queries.getTemplate(ctx.tenantId, id);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }
  if (existing.status === "archived") {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }

  const messageId = randomUUID();

  await queue.publish(COMMANDS.deleteTemplate, {
    messageId,
    type: COMMANDS.deleteTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  // Invalidate cache
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function executeTemplate(ctx: RequestContext, id: string, body: ExecuteTemplateBody): Promise<Accepted> {
  const template = await queries.getTemplate(ctx.tenantId, id);
  if (!template) {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }
  if (template.status === "archived") {
    throw new HttpError(404, "NOT_FOUND", "template not found");
  }

  // Validate required parameters are provided
  for (const param of template.parameters) {
    if (param.required && !(param.name in body.parameters)) {
      if (param.defaultValue === undefined) {
        throw new HttpError(422, "MISSING_PARAMETER", `required parameter '${param.name}' not provided`);
      }
    }
  }

  const jobId = randomUUID();

  await queue.publish(COMMANDS.executeTemplate, {
    messageId: jobId,
    type: COMMANDS.executeTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      templateId: id,
      jobId,
      parameters: body.parameters,
      outputFormat: body.outputFormat ?? template.outputFormat,
    },
  });

  return { id: jobId, status: "accepted", correlationId: ctx.correlationId };
}
