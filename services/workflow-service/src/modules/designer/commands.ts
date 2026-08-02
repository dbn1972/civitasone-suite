/**
 * BPMN Visual Designer — CQRS command layer (create/update/delete/import).
 *
 * Writes are validated synchronously (existence, optimistic-locking version
 * conflict, element-count limit, BPMN XML parse) so the caller still gets an
 * immediate 400/404/409, then a command is published; the consumer (see
 * consumer.ts) applies the actual write and re-checks authoritative
 * conditions under the row's transaction — mirroring instances/commands.ts's
 * publishLifecycle pattern.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { designerDefinitions, type DesignerDefinitionRow, type DesignerNode, type DesignerEdge } from "./schema.js";
import { parseBpmnXml } from "./bpmn-io.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Maximum total elements (nodes + edges) per definition. */
export const MAX_ELEMENTS = 500;

async function findExisting(id: string, tenantId: string): Promise<DesignerDefinitionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(designerDefinitions)
    .where(and(eq(designerDefinitions.id, id), eq(designerDefinitions.tenantId, tenantId))).limit(1));
  const row = rows[0];
  if (!row || row.status === "deleted") return null;
  return row;
}

export interface CreateDefinitionInput {
  name: string;
  description?: string;
  elements: DesignerNode[];
  edges: DesignerEdge[];
}

export async function createDefinition(ctx: RequestContext, body: CreateDefinitionInput): Promise<Accepted> {
  const total = body.elements.length + body.edges.length;
  if (total > MAX_ELEMENTS) {
    throw new HttpError(400, "ELEMENT_LIMIT_EXCEEDED", `Total elements (${total}) exceeds maximum of ${MAX_ELEMENTS}`);
  }

  const id = randomUUID();
  await queue.publish(COMMANDS.createDesignerDefinition, {
    messageId: id,
    type: COMMANDS.createDesignerDefinition,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      name: body.name,
      description: body.description ?? null,
      elements: body.elements,
      edges: body.edges,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface UpdateDefinitionInput {
  name?: string;
  description?: string;
  elements?: DesignerNode[];
  edges?: DesignerEdge[];
  version: number;
}

export async function updateDefinition(ctx: RequestContext, id: string, body: UpdateDefinitionInput): Promise<Accepted> {
  const existing = await findExisting(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "designer definition not found");

  // Optimistic locking: version must match.
  if (existing.version !== body.version) {
    throw new HttpError(409, "VERSION_CONFLICT", `Version conflict: expected ${body.version}, current is ${existing.version}`);
  }

  const newElements = body.elements !== undefined ? body.elements : (existing.elements as DesignerNode[]);
  const newEdges = body.edges !== undefined ? body.edges : (existing.edges as DesignerEdge[]);
  if (newElements.length + newEdges.length > MAX_ELEMENTS) {
    throw new HttpError(400, "ELEMENT_LIMIT_EXCEEDED", `Total elements (${newElements.length + newEdges.length}) exceeds maximum of ${MAX_ELEMENTS}`);
  }

  await queue.publish(COMMANDS.updateDesignerDefinition, {
    messageId: randomUUID(),
    type: COMMANDS.updateDesignerDefinition,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      expectedVersion: body.version,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.elements !== undefined ? { elements: body.elements } : {}),
      ...(body.edges !== undefined ? { edges: body.edges } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDefinition(ctx: RequestContext, id: string): Promise<Accepted> {
  const existing = await findExisting(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "designer definition not found");

  await queue.publish(COMMANDS.deleteDesignerDefinition, {
    messageId: randomUUID(),
    type: COMMANDS.deleteDesignerDefinition,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function importDefinition(ctx: RequestContext, id: string, xml: string): Promise<Accepted> {
  const existing = await findExisting(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "designer definition not found");

  // Parse synchronously — throws BpmnParseError (mapped to 400 by the route's
  // error handler) on malformed/oversized XML before anything is published.
  const parsed = parseBpmnXml(xml);
  const total = parsed.nodes.length + parsed.edges.length;
  if (total > MAX_ELEMENTS) {
    throw new HttpError(400, "ELEMENT_LIMIT_EXCEEDED", `Imported BPMN contains ${total} elements, exceeding maximum of ${MAX_ELEMENTS}`);
  }

  await queue.publish(COMMANDS.importDesignerDefinition, {
    messageId: randomUUID(),
    type: COMMANDS.importDesignerDefinition,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      elements: parsed.nodes,
      edges: parsed.edges,
      processName: parsed.processName,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
