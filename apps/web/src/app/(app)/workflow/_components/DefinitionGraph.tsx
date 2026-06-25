/**
 * Accessible workflow graph view (server component). Renders the definition's
 * nodes as cards with their outgoing transitions, plus an SVG flow strip when
 * the graph is small. No client JS — purely structural so screen readers and
 * print both work. Edge conditions are shown inline (XOR/guards).
 */
import type { WorkflowNode, WorkflowEdge } from "../_data/workflowTypes";
import { titleCase } from "../_data/workflowTypes";

const NODE_ICON: Record<string, string> = {
  start: "▶",
  end: "■",
  task: "◻",
  split: "⋔",
  parallel: "∥",
  join: "⋈",
  xor: "✕",
  exclusive: "✕",
  timer: "⏱",
  call: "↗",
};

function nodeIcon(type: string): string {
  return NODE_ICON[type] ?? "◻";
}

export function DefinitionGraph({ nodes, edges }: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  const ordered = [...nodes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.fromNode) ?? [];
    list.push(e);
    outgoing.set(e.fromNode, list);
  }
  const nameByKey = new Map(nodes.map((n) => [n.nodeKey, n.name]));

  return (
    <ol className="wf-graph" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
      {ordered.map((n) => {
        const outs = outgoing.get(n.nodeKey) ?? [];
        return (
          <li
            key={n.nodeKey}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "12px 14px",
              background: "var(--panel)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--primary-soft)",
                  color: "var(--primary-d)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {nodeIcon(n.nodeType)}
              </span>
              <span style={{ fontWeight: 650, fontSize: 14 }}>{n.name}</span>
              <span className="pill mut np" style={{ fontSize: 11 }}>{titleCase(n.nodeType)}</span>
              {n.roleRef && <span className="pill info np" style={{ fontSize: 11 }}>{n.roleRef}</span>}
              {typeof n.slaMinutes === "number" && (
                <span className="pill warn np" style={{ fontSize: 11 }}>SLA {n.slaMinutes}m</span>
              )}
              {n.assignStrategy && n.assignStrategy !== "none" && (
                <span className="pill mut np" style={{ fontSize: 11 }}>{titleCase(n.assignStrategy)}</span>
              )}
              <span className="mono" style={{ fontSize: 11, color: "var(--mut)", marginLeft: "auto" }}>{n.nodeKey}</span>
            </div>
            {outs.length > 0 && (
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 4 }}>
                {outs.map((e, i) => (
                  <li key={i} style={{ fontSize: 12.5, color: "var(--ink2)", display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span aria-hidden="true">→</span>
                    <span>
                      {nameByKey.get(e.toNode) ?? e.toNode}
                      {e.condition && (
                        <span className="mono" style={{ marginLeft: 8, color: "var(--mut)", fontSize: 11.5 }}>
                          [{e.condition}]
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
