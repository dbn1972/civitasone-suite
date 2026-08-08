"use client";

import type { WorkflowDesignState } from "./workflowConstants";
import { defaultLanes, emptyWorkflowDesign } from "./workflowConstants";
import { lanesFromBpmn, lanesToBpmn, type DesignerNode, type DesignerEdge } from "./workflowRoundTrip";

export { emptyWorkflowDesign };
export { lanesToBpmn, lanesFromBpmn } from "./workflowRoundTrip";

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
  // Template mode regenerates BPMN from guided lanes. Custom mode still persists the
  // last known guided projection so catalogue linkage stays intact; mode is preserved.
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
    return { ...design, version: design.version + 1 };
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
