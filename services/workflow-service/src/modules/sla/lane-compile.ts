/**
 * FN-25 — compile USD guided approval-chain lanes into executable workflow
 * definition nodes with SLA clocks (minutes) and escalation targets.
 */

export interface GuidedLane {
  key: string;
  name: string;
  enabled?: boolean;
  designationId?: string;
  slaDays: number;
  escalationDesignationId?: string;
}

export interface ExecutableNode {
  nodeKey: string;
  name: string;
  nodeType: "start" | "task" | "end";
  roleRef?: string;
  escalateToRef?: string;
  slaMinutes?: number;
  sortOrder: number;
}

export interface ExecutableEdge {
  fromNode: string;
  toNode: string;
  sortOrder: number;
}

/** Convert designer SLA days to workflow engine minutes. */
export function slaDaysToMinutes(slaDays: number): number | null {
  if (!Number.isFinite(slaDays) || slaDays <= 0) return null;
  return Math.round(slaDays * 24 * 60);
}

/**
 * Build a linear executable graph from guided lanes.
 * Start → enabled lanes → End. Action lanes carry slaMinutes + escalateToRef.
 */
export function lanesToExecutableGraph(lanes: GuidedLane[]): {
  nodes: ExecutableNode[];
  edges: ExecutableEdge[];
} {
  const enabled = lanes.filter((l) => l.enabled !== false);
  const nodes: ExecutableNode[] = [
    { nodeKey: "start", name: "Start", nodeType: "start", sortOrder: 0 },
  ];
  const edges: ExecutableEdge[] = [];
  let prev = "start";
  let order = 1;

  for (const lane of enabled) {
    const nodeKey = lane.key === "issued" ? "end" : lane.key;
    const nodeType: ExecutableNode["nodeType"] =
      lane.key === "issued" ? "end" : lane.key === "submitted" ? "task" : "task";
    const minutes = slaDaysToMinutes(lane.slaDays);
    const node: ExecutableNode = {
      nodeKey,
      name: lane.name,
      nodeType: lane.key === "issued" ? "end" : nodeType,
      sortOrder: order,
      ...(lane.designationId ? { roleRef: lane.designationId } : {}),
      ...(lane.escalationDesignationId ? { escalateToRef: lane.escalationDesignationId } : {}),
      ...(minutes != null && lane.key !== "issued" ? { slaMinutes: minutes } : {}),
    };
    // Avoid duplicate end keys if template already has issued.
    if (!nodes.some((n) => n.nodeKey === node.nodeKey)) {
      nodes.push(node);
      edges.push({ fromNode: prev, toNode: node.nodeKey, sortOrder: order });
      prev = node.nodeKey;
      order += 1;
    }
  }

  if (prev !== "end" && !nodes.some((n) => n.nodeKey === "end")) {
    nodes.push({ nodeKey: "end", name: "End", nodeType: "end", sortOrder: order });
    edges.push({ fromNode: prev, toNode: "end", sortOrder: order });
  }

  return { nodes, edges };
}

/**
 * Prefer the superior designation for SLA escalation; fall back to role pool /
 * instance owner (caller supplies fallbacks).
 */
export function resolveEscalationRecipient(opts: {
  escalateToRef?: string | null;
  roleRef?: string | null;
  instanceOwnerId?: string | null;
  instanceId: string;
}): string {
  return opts.escalateToRef
    ?? opts.instanceOwnerId
    ?? opts.roleRef
    ?? opts.instanceId;
}
