"use client";

import { StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { ProjectWbsNode } from "@/app/_data/loaders";

type TreeNode = ProjectWbsNode & { children: TreeNode[] };

function buildTree(nodes: ProjectWbsNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] });
  }
  for (const n of nodes) {
    const treeNode = map.get(n.id)!;
    if (n.parentId && map.has(n.parentId)) {
      map.get(n.parentId)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }
  return roots;
}

function WbsTreeNode({ node, depth }: { node: TreeNode; depth: number }) {
  const isLeaf = node.children.length === 0;
  return (
    <>
      <li
        role="treeitem"
        aria-expanded={node.children.length > 0 ? true : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: `8px 12px 8px ${depth * 24 + 12}px`,
          borderBottom: "1px solid var(--border, #e2e8f0)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, width: 20, textAlign: "center" }}>
          {isLeaf ? "📄" : depth === 0 ? "📦" : "📂"}
        </span>
        <span style={{ flex: 1, fontWeight: depth === 0 ? 600 : depth === 1 ? 500 : 400, fontSize: 14 }}>
          {node.name}
        </span>
        <StatusPill status={node.status} />
      </li>
      {node.children.map((child) => (
        <WbsTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function WbsTree({ nodes, source = "api" }: { nodes: ProjectWbsNode[]; source?: "api" | "error" }) {
  const { data, fromCache, offline, cachedAt } = useSeededResource<ProjectWbsNode[]>(
    "projects.wbs",
    nodes,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tree = buildTree(data);

  return (
    <div style={{ padding: "0 0 8px" }}>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "8px 12px" }}>{cacheNote}</p>}
      <ul role="tree" aria-label="Work breakdown structure" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {tree.map((node) => (
          <WbsTreeNode key={node.id} node={node} depth={0} />
        ))}
      </ul>
    </div>
  );
}
