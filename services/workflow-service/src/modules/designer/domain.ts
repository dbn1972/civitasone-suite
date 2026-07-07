/**
 * BPMN Designer — pure domain logic for graph validation.
 *
 * validateGraph(nodes, edges) checks:
 *   1. Every edge references existing node IDs (source and target)
 *   2. Gateways have at least 1 outgoing flow
 *   3. End events are reachable from start event(s)
 *
 * Must complete within 500ms for graphs up to 500 elements.
 */

import type { DesignerNode, DesignerEdge } from "./schema.js";

export interface Violation {
  nodeId?: string;
  edgeId?: string;
  rule: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

const GATEWAY_TYPES = new Set([
  "exclusiveGateway",
  "parallelGateway",
  "inclusiveGateway",
  "eventBasedGateway",
]);

const START_TYPES = new Set(["startEvent"]);
const END_TYPES = new Set(["endEvent"]);

/**
 * Validates a BPMN designer graph for structural correctness.
 * Pure function — no I/O, no side effects.
 *
 * Rules enforced:
 *   - Every edge must reference existing nodes (source and target)
 *   - Gateways must have at least one outgoing sequence flow
 *   - End events must be reachable from at least one start event
 */
export function validateGraph(nodes: DesignerNode[], edges: DesignerEdge[]): ValidationResult {
  const violations: Violation[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Rule 1: Every edge references existing nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      violations.push({
        edgeId: edge.id,
        rule: "dangling_edge_source",
        message: `Edge '${edge.id}' source '${edge.source}' references a non-existent node`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      violations.push({
        edgeId: edge.id,
        rule: "dangling_edge_target",
        message: `Edge '${edge.id}' target '${edge.target}' references a non-existent node`,
      });
    }
  }

  // Build adjacency list (outgoing edges per node) for valid edges only
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      outgoing.get(edge.source)!.push(edge.target);
    }
  }

  // Rule 2: Gateways must have at least 1 outgoing flow
  for (const node of nodes) {
    if (GATEWAY_TYPES.has(node.type)) {
      const outs = outgoing.get(node.id) ?? [];
      if (outs.length === 0) {
        violations.push({
          nodeId: node.id,
          rule: "gateway_no_outgoing",
          message: `Gateway '${node.id}' (${node.type}) has no outgoing sequence flow`,
        });
      }
    }
  }

  // Rule 3: End events must be reachable from start events
  const startNodes = nodes.filter((n) => START_TYPES.has(n.type));
  const endNodes = nodes.filter((n) => END_TYPES.has(n.type));

  if (startNodes.length > 0 && endNodes.length > 0) {
    // BFS from all start nodes
    const reachable = new Set<string>();
    const queue: string[] = startNodes.map((n) => n.id);
    for (const id of queue) reachable.add(id);

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      for (const neighbor of outgoing.get(current) ?? []) {
        if (!reachable.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Check each end event is reachable
    for (const endNode of endNodes) {
      if (!reachable.has(endNode.id)) {
        violations.push({
          nodeId: endNode.id,
          rule: "end_event_unreachable",
          message: `End event '${endNode.id}' is not reachable from any start event`,
        });
      }
    }
  } else if (startNodes.length === 0 && nodes.length > 0) {
    // If there are nodes but no start event, note as a violation
    violations.push({
      rule: "no_start_event",
      message: "Graph has no start event node",
    });
  } else if (endNodes.length === 0 && nodes.length > 0) {
    // If there are nodes but no end event, note as a violation
    violations.push({
      rule: "no_end_event",
      message: "Graph has no end event node",
    });
  }

  return { valid: violations.length === 0, violations };
}
