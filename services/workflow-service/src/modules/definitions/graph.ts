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
  // adjacency by source node (used for timer/deemed checks + reachability below).
  const outBySrc = new Map<string, string[]>();
  for (const e of edges) {
    if (!keySet.has(e.fromNode) || !keySet.has(e.toNode)) continue;
    const l = outBySrc.get(e.fromNode) ?? [];
    l.push(e.toNode);
    outBySrc.set(e.fromNode, l);
  }
  const nodeByKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const terminalKeys = new Set(terminals.map((t) => t.nodeKey));

  for (const n of nodes) {
    if (n.nodeType !== "timer") continue;
    if (!hasOutgoing.has(n.nodeKey)) {
      errors.push(`timer node '${n.nodeKey}' has no outgoing edge (it can never auto-advance)`);
    }
    // SECURITY C-1b — minimum dwell. A timer's deemed-approval window must be at
    // least 1 minute; timer_minutes = 0 (or negative) would let a due timer be
    // "deemed approved" on the very next sweep tick with effectively no dwell,
    // which launders an instant auto-approval. Reject < 1.
    const tm = n.timerMinutes;
    if (tm !== undefined && tm !== null && tm < 1) {
      errors.push(`timer node '${n.nodeKey}' timer_minutes must be >= 1 (got ${tm}); a zero/negative dwell is not allowed`);
    }
    // SECURITY C-1c — a deemed-approval timer must NOT feed a terminal node. A
    // terminal completion triggers domain dispatch (dispatchDomainApprove) with
    // no further human step, so an opted-in timer that points straight at a
    // terminal would auto-dispatch a money/HR approval. Require a human step
    // between a deemed-approval timer and any terminal.
    if (n.deemedApproval === true) {
      const successors = outBySrc.get(n.nodeKey) ?? [];
      const badTargets = successors.filter((t) => {
        const tn = nodeByKey.get(t);
        return terminalKeys.has(t) || tn?.nodeType === "end";
      });
      if (badTargets.length) {
        errors.push(`deemed-approval timer '${n.nodeKey}' has an outgoing edge directly to terminal/end node(s) (${badTargets.join(", ")}); a human step is required before completion (it would auto-dispatch a domain approval)`);
      }
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

    // SECURITY M-2 — a non-terminal node that can ONLY loop (every outgoing
    // path eventually returns to itself with no escape to any terminal) would
    // strand an instance forever. Compute, for each node, whether SOME terminal
    // is reachable from it; a non-terminal node with outgoing edges from which
    // no terminal is reachable is an ERROR (previously only a cycle warning).
    const canReachTerminal = new Map<string, boolean>();
    const visiting = new Set<string>();
    const reachTerm = (u: string): boolean => {
      if (canReachTerminal.has(u)) return canReachTerminal.get(u)!;
      if (terminals.some((t) => t.nodeKey === u)) { canReachTerminal.set(u, true); return true; }
      if (visiting.has(u)) return false; // on the current DFS stack: no escape via this path
      visiting.add(u);
      let ok = false;
      for (const v of adj.get(u) ?? []) {
        if (reachTerm(v)) { ok = true; break; }
      }
      visiting.delete(u);
      canReachTerminal.set(u, ok);
      return ok;
    };
    for (const n of nodes) {
      const isTerminal = terminals.some((t) => t.nodeKey === n.nodeKey);
      if (isTerminal) continue;
      const outs = adj.get(n.nodeKey) ?? [];
      if (outs.length === 0) continue; // handled by the no-terminal check above
      if (reachable.has(n.nodeKey) && !reachTerm(n.nodeKey)) {
        errors.push(`node '${n.nodeKey}' can only loop: no path from it reaches a terminal/end node (instance would be stranded)`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
