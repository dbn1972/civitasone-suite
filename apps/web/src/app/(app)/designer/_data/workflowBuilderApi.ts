"use client";

import type { WorkflowDesignState, WorkflowLane } from "./workflowConstants";
import { defaultLanes, emptyWorkflowDesign } from "./workflowConstants";

interface DesignerNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  properties?: Record<string, unknown>;
}

interface DesignerEdge {
  id: string;
  source: string;
  target: string;
}

interface DefinitionDetail {
  id: string;
  name: string;
  version: number;
  elements: DesignerNode[];
  edges: DesignerEdge[];
}

async function parseJson(res: Response): Promise<unknown> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

export function lanesToBpmn(lanes: WorkflowLane[]): { elements: DesignerNode[]; edges: DesignerEdge[] } {
  const enabled = lanes.filter((l) => l.enabled);
  const elements: DesignerNode[] = [];
  const edges: DesignerEdge[] = [];
  let x = 80;

  elements.push({
    id: "start_1",
    type: "startEvent",
    label: "Start",
    position: { x, y: 120 },
  });
  x += 140;

  let prevId = "start_1";
  for (const lane of enabled) {
    const nodeId = `lane_${lane.key}`;
    elements.push({
      id: nodeId,
      type: lane.key === "issued" ? "endEvent" : "task",
      label: lane.name,
      position: { x, y: 120 },
      properties: {
        laneKey: lane.key,
        designationId: lane.designationId,
        designationLabel: lane.designationLabel,
        slaDays: lane.slaDays,
      },
    });
    edges.push({ id: `edge_${prevId}_${nodeId}`, source: prevId, target: nodeId });
    prevId = nodeId;
    x += 160;
  }

  if (enabled.every((l) => l.key !== "issued")) {
    elements.push({
      id: "end_1",
      type: "endEvent",
      label: "End",
      position: { x, y: 120 },
    });
    edges.push({ id: `edge_${prevId}_end`, source: prevId, target: "end_1" });
  }

  return { elements, edges };
}

function lanesFromBpmn(elements: DesignerNode[]): WorkflowLane[] | null {
  const tasks = elements.filter((e) => e.type === "task");
  if (tasks.length === 0) return null;
  const base = defaultLanes();
  return base.map((lane) => {
    const node = tasks.find((t) => (t.properties?.laneKey as string) === lane.key)
      ?? tasks.find((t) => t.label.toLowerCase() === lane.name.toLowerCase());
    if (!node) return lane;
    return {
      ...lane,
      name: node.label || lane.name,
      designationId: String(node.properties?.designationId ?? ""),
      designationLabel: String(node.properties?.designationLabel ?? ""),
      slaDays: Number(node.properties?.slaDays ?? lane.slaDays),
      enabled: true,
    };
  });
}

export async function loadWorkflowDesign(
  serviceName: string,
  definitionId?: string | null,
): Promise<WorkflowDesignState> {
  if (!definitionId) return emptyWorkflowDesign(serviceName);

  const res = await fetch(`/api/proxy/v1/workflow/designer/definitions/${definitionId}`, { cache: "no-store" });
  if (!res.ok) return emptyWorkflowDesign(serviceName);

  const payload = (await res.json()) as { data?: DefinitionDetail };
  const detail = payload.data ?? (payload as unknown as DefinitionDetail);
  if (!detail?.id) return emptyWorkflowDesign(serviceName);

  const parsed = lanesFromBpmn(detail.elements ?? []);
  return {
    definitionId: detail.id,
    version: detail.version ?? 1,
    name: detail.name,
    mode: parsed ? "template" : "custom",
    lanes: parsed ?? defaultLanes(),
  };
}

export async function persistWorkflowDesign(design: WorkflowDesignState): Promise<WorkflowDesignState> {
  const { elements, edges } = lanesToBpmn(design.lanes);

  if (design.definitionId) {
    await parseJson(await fetch(`/api/proxy/v1/workflow/designer/definitions/${design.definitionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: design.name,
        elements,
        edges,
        version: design.version,
      }),
    }));
    return { ...design, version: design.version + 1, mode: "template" };
  }

  const created = (await parseJson(await fetch("/api/proxy/v1/workflow/designer/definitions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: design.name, elements, edges }),
  }))) as { id: string };

  return {
    ...design,
    definitionId: created.id,
    version: 1,
    mode: "template",
  };
}

export async function fetchTenantPositions(): Promise<{ id: string; label: string }[]> {
  const res = await fetch("/api/proxy/v1/tenant/positions", { cache: "no-store" });
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: unknown[] };
  const rows = payload.data ?? (Array.isArray(payload) ? payload : []);
  return (rows as Record<string, unknown>[]).map((row, idx) => ({
    id: String(row.id ?? row.code ?? `pos-${idx}`),
    label: String(row.name ?? row.title ?? row.label ?? row.code ?? `Position ${idx + 1}`),
  }));
}
