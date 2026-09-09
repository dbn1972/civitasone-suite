"use client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminOrgUnit } from "@/app/_data/loaders";

// Matches tenant-service's real, flat org-unit taxonomy (org-hierarchy
// module) — there is no "Ministry" level in the backing store, so this page
// does not invent one.
const UNIT_TYPES: AdminOrgUnit["type"][] = ["department", "division", "section", "unit", "branch"];
const TYPE_COLORS: Record<AdminOrgUnit["type"], string> = {
  department: "#4f46e5",
  division: "#0284c7",
  section: "#059669",
  unit: "#d97706",
  branch: "#64748b",
};

type TreeNode = AdminOrgUnit & { children: TreeNode[] };

function buildTree(units: AdminOrgUnit[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const u of units) byId.set(u.id, { ...u, children: [] });
  const roots: TreeNode[] = [];
  for (const u of units) {
    const node = byId.get(u.id)!;
    if (u.parentId && byId.has(u.parentId)) {
      byId.get(u.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/org-hierarchy${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, message: (json as { message?: string }).message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

function CreateUnitForm({
  parentId,
  onDone,
  onCancel,
}: {
  parentId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AdminOrgUnit["type"]>("unit");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    setBusy(true);
    setError(null);
    const result = await callApi("", "POST", {
      name: name.trim(),
      type,
      ...(parentId ? { parentId } : {}),
      ...(code.trim() ? { code: code.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) { setError(result.message ?? "Create failed"); return; }
    onDone();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "var(--surface2, #f8fafc)", borderRadius: 8, marginTop: 4 }}>
      <input
        className="input"
        placeholder="Unit name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ minWidth: 180 }}
        aria-label="New unit name"
        autoFocus
      />
      <select className="input" value={type} onChange={(e) => setType(e.target.value as AdminOrgUnit["type"])} aria-label="New unit type">
        {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        className="input"
        placeholder="Code (optional)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={{ width: 110 }}
        aria-label="New unit code"
      />
      <button type="button" className="btn primary sm" disabled={busy} onClick={() => void submit()} aria-busy={busy}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={onCancel}>Cancel</button>
      {error && <span role="alert" style={{ fontSize: 12, color: "#b42318", width: "100%" }}>{error}</span>}
    </div>
  );
}

function OrgTreeNode({
  node,
  depth,
  editingId,
  addingChildOf,
  onStartRename,
  onCancelRename,
  onRename,
  onStartAddChild,
  onCancelAddChild,
  onUnitAdded,
}: {
  node: TreeNode;
  depth: number;
  editingId: string | null;
  addingChildOf: string | null;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onStartAddChild: (id: string) => void;
  onCancelAddChild: () => void;
  onUnitAdded: () => void;
}) {
  const isEditing = editingId === node.id;
  const isAddingChild = addingChildOf === node.id;
  const color = TYPE_COLORS[node.type];

  return (
    <li style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginLeft: depth * 22, borderRadius: 8 }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} aria-hidden="true" />
        {isEditing ? (
          <input
            defaultValue={node.name}
            autoFocus
            onBlur={(e) => onRename(node.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(node.id, e.currentTarget.value);
              if (e.key === "Escape") onCancelRename();
            }}
            style={{ flex: 1, padding: "2px 6px", fontSize: 13.5, border: "1px solid var(--primary)", borderRadius: 5, fontFamily: "inherit" }}
            aria-label={`Rename ${node.name}`}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 13.5 }}>{node.name}{node.code ? <span style={{ color: "var(--ink3)", fontSize: 11.5 }}> · {node.code}</span> : null}</span>
        )}
        <span style={{ fontSize: 10.5, color, background: `${color}18`, padding: "2px 7px", borderRadius: 10, fontWeight: 650, flexShrink: 0 }}>{node.type}</span>
        <button type="button" className="btn ghost sm" style={{ fontSize: 11 }} onClick={() => onStartRename(node.id)}>Rename</button>
        <button type="button" className="btn ghost sm" style={{ fontSize: 11 }} onClick={() => onStartAddChild(node.id)}>+ Add child</button>
      </div>
      {isAddingChild && (
        <div style={{ marginLeft: (depth + 1) * 22 }}>
          <CreateUnitForm parentId={node.id} onDone={onUnitAdded} onCancel={onCancelAddChild} />
        </div>
      )}
      {node.children.length > 0 && (
        <ul role="group" style={{ margin: 0, padding: 0 }}>
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              editingId={editingId}
              addingChildOf={addingChildOf}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onRename={onRename}
              onStartAddChild={onStartAddChild}
              onCancelAddChild={onCancelAddChild}
              onUnitAdded={onUnitAdded}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgHierarchyManager({ initialUnits, source }: { initialUnits: AdminOrgUnit[]; source: "api" | "error" }) {
  const [units, setUnits] = useState<AdminOrgUnit[]>(initialUnits);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => buildTree(units), [units]);

  async function refresh() {
    try {
      const res = await fetch("/api/proxy/v1/admin/org-hierarchy", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: AdminOrgUnit[] } | AdminOrgUnit[];
      const rows = Array.isArray(body) ? body : body.data ?? [];
      setUnits(rows);
    } catch {
      // keep current state
    }
  }

  async function handleRename(id: string, name: string) {
    const trimmed = name.trim();
    setEditingId(null);
    if (!trimmed) return;
    const existing = units.find((u) => u.id === id);
    if (existing && existing.name === trimmed) return;
    setBusy(true);
    setError(null);
    const result = await callApi(`/${id}`, "PATCH", { name: trimmed });
    setBusy(false);
    if (!result.ok) { setError(result.message ?? "Rename failed"); return; }
    await refresh();
  }

  function handleUnitAdded() {
    setAddingChildOf(null);
    setAddingRoot(false);
    void refresh();
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Org Hierarchy"
        subtitle="Organisational structure — department, division, section, unit, branch."
        back="/admin"
        actions={<button type="button" className="btn primary sm" onClick={() => setAddingRoot((v) => !v)}>+ Add top-level unit</button>}
      />
      <DataSourceBadge source={source} message="Couldn't load the org hierarchy — showing nothing" />
      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div className="card">
        <div className="card-h">
          <h3>Organisation tree</h3>
          <p style={{ fontSize: 12, color: "var(--ink3)", margin: 0 }}>{busy ? "Saving…" : "Rename or add children below. Every change saves immediately."}</p>
        </div>
        {addingRoot && (
          <div style={{ padding: "8px 16px" }}>
            <CreateUnitForm parentId={null} onDone={handleUnitAdded} onCancel={() => setAddingRoot(false)} />
          </div>
        )}
        <div style={{ padding: "12px 8px" }}>
          {tree.length === 0 ? (
            <p style={{ padding: 16, color: "var(--ink3)", fontSize: 13 }}>
              {source === "error" ? "Couldn't load the org hierarchy." : "No organisational units yet — add a top-level unit to get started."}
            </p>
          ) : (
            <ul role="tree" aria-label="Organisation hierarchy" style={{ margin: 0, padding: 0 }}>
              {tree.map((node) => (
                <OrgTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  editingId={editingId}
                  addingChildOf={addingChildOf}
                  onStartRename={setEditingId}
                  onCancelRename={() => setEditingId(null)}
                  onRename={(id, name) => void handleRename(id, name)}
                  onStartAddChild={(id) => setAddingChildOf(id)}
                  onCancelAddChild={() => setAddingChildOf(null)}
                  onUnitAdded={handleUnitAdded}
                />
              ))}
            </ul>
          )}
        </div>
        <div style={{ padding: "8px 16px 16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {UNIT_TYPES.map((t) => (
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink3)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: TYPE_COLORS[t], display: "inline-block" }} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
