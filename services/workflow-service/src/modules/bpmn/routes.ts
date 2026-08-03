/**
 * BPMN 2.0 import/export module for workflow-service.
 *
 * Provides:
 *   POST /v1/workflow/definitions/import   — import a BPMN 2.0 XML file as a workflow definition
 *   GET  /v1/workflow/definitions/:id/bpmn — export a definition as BPMN 2.0 XML
 *
 * The import parses BPMN XML → extracts nodes (tasks, gateways, events) and
 * sequence flows → maps to our internal definition schema (nodes[] + edges[]).
 *
 * The export converts our internal schema back to valid BPMN 2.0 XML.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as defRepo from "../definitions/repo.js";
import { randomUUID } from "node:crypto";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as definitionCommands from "../definitions/commands.js";

const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

// ── BPMN XML Parsing (simplified) ─────────────────────────────────

interface BpmnNode {
  id: string;
  name: string;
  type: "startEvent" | "endEvent" | "userTask" | "serviceTask" | "exclusiveGateway" | "parallelGateway" | "intermediateEvent";
}

interface BpmnEdge {
  id: string;
  sourceRef: string;
  targetRef: string;
  name?: string | undefined;
  condition?: string | undefined;
}

function parseBpmnXml(xml: string): { nodes: BpmnNode[]; edges: BpmnEdge[]; processName: string } {
  const nodes: BpmnNode[] = [];
  const edges: BpmnEdge[] = [];

  // Extract process name
  const processMatch = xml.match(/<bpmn:process[^>]*name="([^"]*)"/) ?? xml.match(/<process[^>]*name="([^"]*)"/);
  const processName = processMatch?.[1] ?? "Imported Process";

  // Extract nodes (simplified regex-based parser for common BPMN elements)
  const nodeTypes: Array<{ tag: string; type: BpmnNode["type"] }> = [
    { tag: "startEvent", type: "startEvent" },
    { tag: "endEvent", type: "endEvent" },
    { tag: "userTask", type: "userTask" },
    { tag: "serviceTask", type: "serviceTask" },
    { tag: "exclusiveGateway", type: "exclusiveGateway" },
    { tag: "parallelGateway", type: "parallelGateway" },
    { tag: "intermediateCatchEvent", type: "intermediateEvent" },
    { tag: "intermediateThrowEvent", type: "intermediateEvent" },
  ];

  for (const { tag, type } of nodeTypes) {
    const re = new RegExp(`<(?:bpmn:)?${tag}[^>]*id="([^"]*)"[^>]*(?:name="([^"]*)")?`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      nodes.push({ id: m[1]!, name: m[2] ?? tag, type });
    }
    // Also match when name comes before id
    const re2 = new RegExp(`<(?:bpmn:)?${tag}[^>]*name="([^"]*)"[^>]*id="([^"]*)"`, "g");
    while ((m = re2.exec(xml)) !== null) {
      if (!nodes.find((n) => n.id === m![2])) {
        nodes.push({ id: m[2]!, name: m[1] ?? tag, type });
      }
    }
  }

  // Extract sequence flows (edges)
  const flowRe = /(<(?:bpmn:)?sequenceFlow[^>]*id="([^"]*)"[^>]*sourceRef="([^"]*)"[^>]*targetRef="([^"]*)"[^>]*(?:name="([^"]*)")?[^>]*\/?>)/g;
  let fm: RegExpExecArray | null;
  while ((fm = flowRe.exec(xml)) !== null) {
    edges.push({ id: fm[2]!, sourceRef: fm[3]!, targetRef: fm[4]!, name: fm[5] });
  }

  return { nodes, edges, processName };
}

// ── BPMN XML Generation ───────────────────────────────────────────

function generateBpmnXml(
  processName: string,
  nodes: Array<{ id: string; name: string; type: string }>,
  edges: Array<{ id: string; from: string; to: string; label?: string | undefined }>,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const processId = `Process_${randomUUID().slice(0, 8)}`;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  targetNamespace="https://civitasone.in/bpmn"
  id="Definitions_1">
  <process id="${processId}" name="${esc(processName)}" isExecutable="true">
`;

  for (const node of nodes) {
    const bpmnType = mapToBpmnTag(node.type);
    xml += `    <${bpmnType} id="${esc(node.id)}" name="${esc(node.name)}" />\n`;
  }

  for (const edge of edges) {
    xml += `    <sequenceFlow id="${esc(edge.id)}" sourceRef="${esc(edge.from)}" targetRef="${esc(edge.to)}"`;
    if (edge.label) xml += ` name="${esc(edge.label)}"`;
    xml += ` />\n`;
  }

  xml += `  </process>
</definitions>`;

  return xml;
}

function mapToBpmnTag(type: string): string {
  switch (type) {
    case "start": case "startEvent": return "startEvent";
    case "end": case "endEvent": return "endEvent";
    case "userTask": case "task": case "approval": return "userTask";
    case "serviceTask": case "auto": return "serviceTask";
    case "exclusiveGateway": case "decision": return "exclusiveGateway";
    case "parallelGateway": case "fork": case "join": return "parallelGateway";
    default: return "task";
  }
}

// ── Routes ────────────────────────────────────────────────────────

export async function bpmnRoutes(app: FastifyInstance): Promise<void> {
  /** Import BPMN 2.0 XML → create workflow definition */
  app.post("/v1/workflow/definitions/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const body = z.object({
      xml: z.string().min(50).max(1_000_000),
      name: z.string().min(1).max(200).optional(),
    }).parse(req.body);

    const parsed = parseBpmnXml(body.xml);
    if (parsed.nodes.length === 0) {
      throw new HttpError(400, "INVALID_BPMN", "No process elements found in the BPMN XML");
    }

    const typeMap: Record<string, string> = {
      startEvent: "start", endEvent: "end", userTask: "task", serviceTask: "task",
      exclusiveGateway: "xor", parallelGateway: "split", intermediateEvent: "message_catch",
    };
    return sendAccepted(reply, acceptedResponseSchema, await definitionCommands.importBpmnDefinition(ctx, {
      code: `imported_${Date.now()}`,
      name: body.name ?? parsed.processName,
      nodes: parsed.nodes.map((node, index) => ({ nodeKey: node.id, name: node.name, nodeType: typeMap[node.type], sortOrder: index + 1 })),
      edges: parsed.edges.map((edge) => ({ fromNode: edge.sourceRef, toNode: edge.targetRef, condition: edge.condition })),
    }));
  });

  /** Export workflow definition as BPMN 2.0 XML */
  app.get("/v1/workflow/definitions/:id/bpmn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const def = await defRepo.findById(id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "workflow definition not found");

    // Load nodes and edges from their respective tables
    const defNodes = await defRepo.listNodes(id);
    const defEdges = await defRepo.listEdges(id);

    const nodes = defNodes.map((n) => ({ id: n.id, name: n.name, type: n.nodeType }));
    const edges = defEdges.map((e) => ({ id: e.id, from: e.fromNode, to: e.toNode, label: e.condition ?? undefined }));
    const xml = generateBpmnXml(def.name, nodes, edges);

    return reply
      .header("Content-Type", "application/xml")
      .header("Content-Disposition", `attachment; filename="${def.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.bpmn"`)
      .send(xml);
  });

  app.setErrorHandler((err, req, reply) => {
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
