import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateGraph } from "./graph.js";
import type { EdgeSpec, NodeSpec } from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };
type Layout = { width?: number | undefined; height?: number | undefined; zoom?: number | undefined; gridSize?: number | undefined };

async function publish(ctx: RequestContext, type: string, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string | undefined) ?? randomUUID();
  await queue.publish(type, {
    messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDefinition(ctx: RequestContext, body: {
  code: string; name: string; description?: string; nodes: NodeSpec[]; edges: EdgeSpec[]; layout?: Layout;
}): Promise<Accepted> {
  if (body.nodes.length || body.edges.length) {
    const validation = validateGraph(body.nodes, body.edges);
    if (!validation.valid) throw new HttpError(400, "INVALID_GRAPH", `invalid workflow graph: ${validation.errors.join("; ")}`);
  }
  return publish(ctx, COMMANDS.createDefinition, { ...body, id: randomUUID() });
}

export async function deployDefinition(ctx: RequestContext, id: string): Promise<Accepted> {
  const def = await repo.findById(id, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");
  if (def.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "definition already deployed");
  const [nodes, edges] = await Promise.all([repo.listNodes(id), repo.listEdges(id)]);
  const validation = validateGraph(nodes.map((n) => ({ ...n, nodeKey: n.nodeKey })), edges);
  if (!validation.valid) throw new HttpError(400, "INVALID_GRAPH", `cannot deploy: ${validation.errors.join("; ")}`);
  return publish(ctx, COMMANDS.deployDefinition, { id });
}

export async function cloneTemplate(ctx: RequestContext, templateId: string, body: { code?: string; name?: string }): Promise<Accepted> {
  const template = await repo.findTemplateById(templateId);
  if (!template) throw new HttpError(404, "NOT_FOUND", "template not found");
  return publish(ctx, COMMANDS.cloneDefinitionTemplate, {
    id: randomUUID(), templateId, code: body.code ?? template.code, name: body.name ?? template.name,
  });
}

export async function rollbackDefinition(ctx: RequestContext, code: string, version: number): Promise<Accepted> {
  const target = await scopedRead((tx) => repo.findByCodeVersionTx(tx, ctx.tenantId, code, version));
  if (!target) throw new HttpError(404, "VERSION_NOT_FOUND", `version ${version} of '${code}' not found`);
  if (target.status === "active") throw new HttpError(409, "ALREADY_ACTIVE", "target version is already active");
  const [nodes, edges] = await Promise.all([repo.listNodes(target.id), repo.listEdges(target.id)]);
  const validation = validateGraph(nodes.map((n) => ({ ...n, nodeKey: n.nodeKey })), edges);
  if (!validation.valid) throw new HttpError(409, "TARGET_INVALID_GRAPH", `cannot roll back to an invalid graph: ${validation.errors.join("; ")}`);
  return publish(ctx, COMMANDS.rollbackDefinition, { id: target.id, code, version });
}

export async function importBpmnDefinition(ctx: RequestContext, body: {
  code: string; name: string; nodes: NodeSpec[]; edges: EdgeSpec[];
}): Promise<Accepted> {
  return publish(ctx, COMMANDS.importBpmnDefinition, { ...body, id: randomUUID() });
}
