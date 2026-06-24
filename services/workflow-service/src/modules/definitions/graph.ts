import type { NodeSpec, EdgeSpec } from "./repo.js";

export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * P0-1 — Structural validation of a workflow definition graph. Run on create
 * and (strictly) on deploy so a typo'd edge target or a missing terminal can
 * never be activated and silently strand instances. Enforces:
 *   - exactly one start node (nodeType "start", else lowest-sort-order node);
 *   - at least one terminal/end node that is reachable from the start;
 *   - every edge's from/to references an existing nodeKey;
 *   - all nodes reachable from the start (BFS over edges);
 *   - cycles are reported as warnings (intended self-loops excluded).
 */
export function validateGraph(nodes: NodeSpec[], edges: EdgeSpec[]): GraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (nodes.length === 0) {
    errors.push("graph has no nodes");
    return { valid: false, errors, warnings };
  }

  const keys = nodes.map((n) => n.nodeKey);
  const keySet = new Set(keys);

  // duplicate node keys
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) errors.push(`duplicate nodeKey '${k}'`);
    seen.add(k);
  }

  // edge endpoint references must exist
  for (const e of edges) {
    if (!keySet.has(e.fromNode)) errors.push(`edge fromNode '${e.fromNode}' references a missing node`);
    if (!keySet.has(e.toNode)) errors.push(`edge toNode '${e.toNode}' references a missing node`);
  }

  // start node: exactly one. Prefer explicit nodeType "start"; otherwise the
  // unique node with no incoming edges; otherwise the lowest-sort-order node.
  const explicitStarts = nodes.filter((n) => n.nodeType === "start");
  if (explicitStarts.length > 1) {
    errors.push(`exactly one start node required, found ${explicitStarts.length}`);
  }
  const hasIncoming = new Set(edges.filter((e) => keySet.has(e.toNode)).map((e) => e.toNode));
  const roots = nodes.filter((n) => !hasIncoming.has(n.nodeKey));
  if (explicitStarts.length === 0 && roots.length > 1) {
    errors.push(`exactly one start node required: ${roots.length} nodes have no incoming edge (${roots.map((r) => r.nodeKey).join(", ")})`);
  }

  const start =
    explicitStarts[0]?.nodeKey ??
    roots[0]?.nodeKey ??
    [...nodes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0]?.nodeKey;

  // terminal nodes: explicit "end" type OR a node with no outgoing edges.
  const hasOutgoing = new Set(edges.filter((e) => keySet.has(e.fromNode)).map((e) => e.fromNode));
  // P1-2 — a `timer` node auto-advances along an outgoing edge; it is NEVER a
  // terminal even with no outgoing edge — instead that's an error (it would
  // strand the instance because nothing completes it).
  const terminals = nodes.filter((n) => n.nodeType !== "timer" && (n.nodeType === "end" || !hasOutgoing.has(n.nodeKey)));
  if (terminals.length === 0) {
    errors.push("no terminal/end node: every node has an outgoing edge (workflow can never complete)");
  }
  for (const n of nodes) {
    if (n.nodeType === "timer" && !hasOutgoing.has(n.nodeKey)) {
      errors.push(`timer node '${n.nodeKey}' has no outgoing edge (it can never auto-advance)`);
    }
  }

  // BFS reachability from start
  if (start) {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!keySet.has(e.fromNode) || !keySet.has(e.toNode)) continue;
      const list = adj.get(e.fromNode) ?? [];
      list.push(e.toNode);
      adj.set(e.fromNode, list);
    }
    const reachable = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of adj.get(cur) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          stack.push(next);
        }
      }
    }
    const unreachable = keys.filter((k) => !reachable.has(k));
    if (unreachable.length) {
      errors.push(`unreachable node(s) from start '${start}': ${unreachable.join(", ")}`);
    }
    const reachableTerminal = terminals.some((t) => reachable.has(t.nodeKey));
    if (terminals.length > 0 && !reachableTerminal) {
      errors.push(`no terminal/end node is reachable from start '${start}'`);
    }

    // cycle detection (DFS with recursion stack), excluding self-loops which
    // are treated as intended loops -> warnings only.
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(keys.map((k) => [k, WHITE]));
    const cycleNodes: string[] = [];
    const dfs = (u: string): void => {
      color.set(u, GRAY);
      for (const v of adj.get(u) ?? []) {
        if (v === u) continue; // self-loop = intended loop
        if (color.get(v) === GRAY) {
          cycleNodes.push(`${u}->${v}`);
        } else if (color.get(v) === WHITE) {
          dfs(v);
        }
      }
      color.set(u, BLACK);
    };
    for (const k of keys) if (color.get(k) === WHITE) dfs(k);
    if (cycleNodes.length) {
      warnings.push(`cycle(s) detected (verify these are intended loops): ${cycleNodes.join(", ")}`);
    }
    for (const n of nodes) {
      if ((adj.get(n.nodeKey) ?? []).includes(n.nodeKey)) {
        warnings.push(`self-loop on node '${n.nodeKey}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
