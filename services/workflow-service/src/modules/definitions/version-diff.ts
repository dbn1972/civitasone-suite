/**
 * CAP-030 — Workflow version diff (pure domain).
 *
 * Structural comparison of two definition versions (same code). Reports nodes
 * and edges added / removed / changed and flags whether the change is BREAKING
 * for in-flight cases — i.e. a node present in the old version was removed in
 * the new one, so any instance currently sitting on that node could not be
 * migrated forward without an explicit remap. (In-flight instances always run
 * their pinned version, so a diff never *forces* migration; the breaking flag
 * is advisory for operators deciding whether to migrate live cases.)
 */

export interface DiffNode {
  nodeKey: string;
  name: string;
  nodeType: string;
  roleRef?: string | null;
  slaMinutes?: number | null;
}

export interface DiffEdge {
  fromNode: string;
  toNode: string;
  condition?: string | null;
}

export interface VersionGraph {
  version: number;
  nodes: DiffNode[];
  edges: DiffEdge[];
}

export interface NodeChange {
  nodeKey: string;
  changes: string[];
}

export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  nodesAdded: string[];
  nodesRemoved: string[];
  nodesChanged: NodeChange[];
  edgesAdded: string[];
  edgesRemoved: string[];
  /** Removing a node that in-flight cases may occupy is breaking. */
  breaking: boolean;
  /** Node keys whose removal makes the change breaking. */
  breakingNodes: string[];
}

function edgeKey(e: DiffEdge): string {
  return `${e.fromNode}->${e.toNode}${e.condition ? `[${e.condition}]` : ""}`;
}

function nodeDelta(a: DiffNode, b: DiffNode): string[] {
  const changes: string[] = [];
  if (a.name !== b.name) changes.push(`name: '${a.name}' → '${b.name}'`);
  if (a.nodeType !== b.nodeType) changes.push(`nodeType: '${a.nodeType}' → '${b.nodeType}'`);
  if ((a.roleRef ?? null) !== (b.roleRef ?? null)) {
    changes.push(`roleRef: '${a.roleRef ?? ""}' → '${b.roleRef ?? ""}'`);
  }
  if ((a.slaMinutes ?? null) !== (b.slaMinutes ?? null)) {
    changes.push(`slaMinutes: ${a.slaMinutes ?? "∅"} → ${b.slaMinutes ?? "∅"}`);
  }
  return changes;
}

/** Diff two version graphs (a = from/old, b = to/new). */
export function diffVersions(a: VersionGraph, b: VersionGraph): VersionDiff {
  const aNodes = new Map(a.nodes.map((n) => [n.nodeKey, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.nodeKey, n]));

  const nodesAdded: string[] = [];
  const nodesRemoved: string[] = [];
  const nodesChanged: NodeChange[] = [];

  for (const key of bNodes.keys()) if (!aNodes.has(key)) nodesAdded.push(key);
  for (const [key, an] of aNodes) {
    const bn = bNodes.get(key);
    if (!bn) {
      nodesRemoved.push(key);
      continue;
    }
    const changes = nodeDelta(an, bn);
    if (changes.length) nodesChanged.push({ nodeKey: key, changes });
  }

  const aEdges = new Set(a.edges.map(edgeKey));
  const bEdges = new Set(b.edges.map(edgeKey));
  const edgesAdded: string[] = [];
  const edgesRemoved: string[] = [];
  for (const k of bEdges) if (!aEdges.has(k)) edgesAdded.push(k);
  for (const k of aEdges) if (!bEdges.has(k)) edgesRemoved.push(k);

  const breakingNodes = [...nodesRemoved].sort();
  return {
    fromVersion: a.version,
    toVersion: b.version,
    nodesAdded: nodesAdded.sort(),
    nodesRemoved: breakingNodes,
    nodesChanged: nodesChanged.sort((x, y) => x.nodeKey.localeCompare(y.nodeKey)),
    edgesAdded: edgesAdded.sort(),
    edgesRemoved: edgesRemoved.sort(),
    breaking: breakingNodes.length > 0,
    breakingNodes,
  };
}
