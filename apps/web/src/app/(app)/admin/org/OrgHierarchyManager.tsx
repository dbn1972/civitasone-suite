"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, LoadErrorState, PageHeader } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { AdminOrgUnit } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";

// Matches tenant-service's real, flat org-unit taxonomy (org-hierarchy
// module) — there is no "Ministry" level in the backing store, so this page
// does not invent one.
const UNIT_TYPES: AdminOrgUnit["type"][] = ["department", "division", "section", "unit", "branch"];
// GAP-ADMIN-ORG-05: theme tokens (they switch with data-theme), not hard-coded hex.
const TYPE_COLORS: Record<AdminOrgUnit["type"], string> = {
  department: "var(--primary)",
  division: "var(--info)",
  section: "var(--good)",
  unit: "var(--warn)",
  branch: "var(--mut)",
};

// Backend (tenant-service org-hierarchy routes.ts) accepts code up to 32 chars; the
// character set below keeps codes usable as identifiers and is checked before any POST.
export const ORG_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Large trees start collapsed below the first level so the page is navigable. */
const LARGE_TREE = 50;
/** The reparent is queued (202); re-read a few times until the tree shows it. */
const MOVE_POLL_ATTEMPTS = 4;
const MOVE_POLL_MS = 1200;

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

/** Ids of `rootId` and everything beneath it -- a unit may not be moved under any of these. */
export function selfAndDescendantIds(units: AdminOrgUnit[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Plain-language failure message for a failed org-unit call. This is a
 * plain async API helper, not a component, so it can't use the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on — never the backend's own `message` or the
 * raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function orgUnitError(): string {
  const human = toHumanError("save", { area: "organisational unit" });
  return `${human.what} ${human.next}`;
}

async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; status?: number; code?: string }> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/org-hierarchy${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const code = ((await res.json().catch(() => undefined)) as { code?: string } | undefined)?.code;
      return { ok: false, message: orgUnitError(), status: res.status, ...(code ? { code } : {}) };
    }
    return { ok: true, status: res.status };
  } catch {
    return { ok: false, message: orgUnitError() };
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
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    // GAP-ADMIN-ORG-05: validate the code before anything is sent.
    const trimmedCode = code.trim();
    if (trimmedCode && !ORG_CODE_PATTERN.test(trimmedCode)) {
      setError("Code may only contain letters, digits, hyphen and underscore (up to 32 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await callApi("", "POST", {
      name: name.trim(),
      type,
      ...(parentId ? { parentId } : {}),
      ...(trimmedCode ? { code: trimmedCode } : {}),
    });
    setBusy(false);
    if (!result.ok) { setError(result.message ?? null); return; }
    onDone();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "var(--surface2, #f8fafc)", borderRadius: 8, marginTop: 4 }}>
      <input
        ref={nameInputRef}
        className="input"
        placeholder="Unit name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ minWidth: 180 }}
        aria-label="New unit name"
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
      <Button size="sm" onClick={() => void submit()} loading={busy}>
        {busy ? "Adding…" : "Add"}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
      {error && <span role="alert" style={{ fontSize: 12, color: "var(--bad)", width: "100%" }}>{error}</span>}
    </div>
  );
}

function OrgTreeNode({
  node,
  depth,
  editingId,
  addingChildOf,
  collapsed,
  onToggleCollapse,
  onStartRename,
  onCancelRename,
  onRename,
  onStartMove,
  onStartAddChild,
  onCancelAddChild,
  onUnitAdded,
}: {
  node: TreeNode;
  depth: number;
  editingId: string | null;
  addingChildOf: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onStartMove: (id: string) => void;
  onStartAddChild: (id: string) => void;
  onCancelAddChild: () => void;
  onUnitAdded: () => void;
}) {
  const isEditing = editingId === node.id;
  const isAddingChild = addingChildOf === node.id;
  const color = TYPE_COLORS[node.type];
  const renameInputRef = useRef<HTMLInputElement>(null);
  // GAP-ADMIN-ORG-02: a rename is committed exactly once per edit session. Enter and
  // Escape unmount the input, which can fire a trailing blur; `settled` makes that
  // blur a no-op so Enter never double-PATCHes and Escape can never save.
  const settledRef = useRef(false);
  useEffect(() => {
    if (isEditing) {
      settledRef.current = false;
      renameInputRef.current?.focus();
    }
  }, [isEditing]);
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.id);

  return (
    <li style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginInlineStart: depth * 22, borderRadius: 8 }}>
        {hasChildren ? (
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.name}`}
            onClick={() => onToggleCollapse(node.id)}
            style={{ width: 24, padding: 0, fontSize: 12 }}
          >
            <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
          </button>
        ) : (
          <span style={{ width: 24, flexShrink: 0 }} aria-hidden="true" />
        )}
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} aria-hidden="true" />
        {isEditing ? (
          <input
            ref={renameInputRef}
            defaultValue={node.name}
            onBlur={(e) => {
              if (settledRef.current) return;
              settledRef.current = true;
              onRename(node.id, e.target.value);
            }}
            onKeyDown={(e) => {
              if (settledRef.current) return;
              if (e.key === "Enter") {
                settledRef.current = true;
                onRename(node.id, e.currentTarget.value);
              } else if (e.key === "Escape") {
                settledRef.current = true;
                onCancelRename();
              }
            }}
            style={{ flex: 1, padding: "2px 6px", fontSize: 13.5, border: "1px solid var(--primary)", borderRadius: 5, fontFamily: "inherit" }}
            aria-label={`Rename ${node.name}`}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 13.5 }}>{node.name}{node.code ? <span style={{ color: "var(--mut)", fontSize: 12 }}> · {node.code}</span> : null}</span>
        )}
        <span style={{ fontSize: 12, color, background: `color-mix(in srgb, ${color} 14%, transparent)`, padding: "2px 8px", borderRadius: 10, fontWeight: 650, flexShrink: 0 }}>{node.type}</span>
        <Button variant="ghost" size="sm" style={{ fontSize: 12 }} aria-label={`Rename ${node.name}`} onClick={() => onStartRename(node.id)}>Rename</Button>
        <Button variant="ghost" size="sm" style={{ fontSize: 12 }} aria-label={`Move ${node.name}`} onClick={() => onStartMove(node.id)}>Move</Button>
        <Button variant="ghost" size="sm" style={{ fontSize: 12 }} aria-label={`Add child unit under ${node.name}`} onClick={() => onStartAddChild(node.id)}>+ Add child</Button>
      </div>
      {isAddingChild && (
        <div style={{ marginInlineStart: (depth + 1) * 22 }}>
          <CreateUnitForm parentId={node.id} onDone={onUnitAdded} onCancel={onCancelAddChild} />
        </div>
      )}
      {hasChildren && !isCollapsed && (
        <ul style={{ margin: 0, padding: 0 }} aria-label={`${node.name} sub-units`}>
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              editingId={editingId}
              addingChildOf={addingChildOf}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onRename={onRename}
              onStartMove={onStartMove}
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

export function OrgHierarchyManager({
  initialUnits,
  source,
  errorStatus,
  errorMessage,
}: {
  initialUnits: AdminOrgUnit[];
  source: "api" | "error";
  errorStatus?: number;
  errorMessage?: string;
}) {
  const [units, setUnits] = useState<AdminOrgUnit[]>(initialUnits);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [addingRoot, setAddingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (initialUnits.length <= LARGE_TREE) return new Set();
    const next = new Set<string>();
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        if (n.children.length > 0 && depth >= 1) next.add(n.id);
        walk(n.children, depth + 1);
      }
    };
    walk(buildTree(initialUnits), 0);
    return next;
  });

  const tree = useMemo(() => buildTree(units), [units]);
  // GAP-ADMIN-ORG-05: a failed load with nothing to show is a failure state, not an empty tree.
  const loadFailed = source === "error" && units.length === 0;

  async function refresh(): Promise<AdminOrgUnit[] | null> {
    try {
      const res = await fetch("/api/proxy/v1/admin/org-hierarchy", { cache: "no-store" });
      if (!res.ok) {
        setError("Saved, but the tree could not be refreshed — reload the page to see the latest structure.");
        return null;
      }
      const body = (await res.json()) as { data?: AdminOrgUnit[] } | AdminOrgUnit[];
      const rows = Array.isArray(body) ? body : body.data ?? [];
      setUnits(rows);
      return rows;
    } catch {
      setError("Saved, but the tree could not be refreshed — reload the page to see the latest structure.");
      return null;
    }
  }

  async function handleRename(id: string, name: string) {
    const trimmed = name.trim();
    setEditingId(null);
    if (!trimmed) return;
    const existing = units.find((u) => u.id === id);
    if (existing && existing.name === trimmed) return;
    if (inFlightRef.current) return; // never two writes at once
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await callApi(`/${id}`, "PATCH", { name: trimmed });
      if (!result.ok) { setError(result.message ?? "Rename failed"); return; }
      await refresh();
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  async function handleMove() {
    const id = movingId;
    if (!id || inFlightRef.current) return;
    const target = moveTarget === "" ? null : moveTarget;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setMoveError(null);
    try {
      // tenant-service PATCH /v1/org/hierarchy/:id takes parentId (null = top level) and
      // rejects a reparent that would create a cycle (409 HIERARCHY_CYCLE); the picker also
      // excludes the unit and its descendants so that case is not normally offered.
      const result = await callApi(`/${id}`, "PATCH", { parentId: target });
      if (!result.ok) {
        // Keep the dialog open and say why, in the dialog itself.
        setMoveError(
          result.code === "HIERARCHY_CYCLE" || result.status === 409
            ? "That move would place the unit under one of its own sub-units, so it was not applied. Choose a different parent."
            : result.message ?? "Move failed",
        );
        return;
      }
      // 202: the change is applied asynchronously, so the tree may not reflect it yet.
      setMovingId(null);
      setNotice("Move accepted — the tree updates shortly.");
      for (let attempt = 0; attempt < MOVE_POLL_ATTEMPTS; attempt++) {
        const rows = await refresh();
        if (rows?.find((u) => u.id === id)?.parentId === target) {
          setNotice("Move applied.");
          return;
        }
        if (attempt < MOVE_POLL_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, MOVE_POLL_MS));
      }
      setNotice("Move accepted — it has not appeared yet. Reload the page in a moment to see the updated tree.");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  function handleUnitAdded() {
    setAddingChildOf(null);
    setAddingRoot(false);
    void refresh();
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const movingUnit = movingId ? units.find((u) => u.id === movingId) : undefined;
  const blockedParents = movingId ? selfAndDescendantIds(units, movingId) : new Set<string>();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Org Hierarchy"
        subtitle="Organisational structure — department, division, section, unit, branch."
        back="/admin"
        actions={<Button size="sm" disabled={loadFailed} onClick={() => setAddingRoot((v) => !v)}>+ Add top-level unit</Button>}
      />
      {!loadFailed && <DataSourceBadge source={source} message="Couldn't load the org hierarchy — showing nothing" />}
      {error && (
        <div role="alert" style={{ background: "var(--badbg)", color: "var(--bad)", border: "1px solid var(--badbd)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ background: "var(--infobg)", color: "var(--info)", border: "1px solid var(--infobd)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {notice}
        </div>
      )}
      <div className="card">
        <div className="card-h">
          <h3>Organisation tree</h3>
          <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>{busy ? "Saving…" : "Rename, move or add children below. Each change is sent to the server as soon as you confirm it."}</p>
        </div>
        {addingRoot && !loadFailed && (
          <div style={{ padding: "8px 16px" }}>
            <CreateUnitForm parentId={null} onDone={handleUnitAdded} onCancel={() => setAddingRoot(false)} />
          </div>
        )}
        <div style={{ padding: "12px 8px" }}>
          {loadFailed ? (
            <LoadErrorState result={{ status: errorStatus, errorMessage }} area="organisation hierarchy" backHref="/admin" />
          ) : tree.length === 0 ? (
            <p style={{ padding: 16, color: "var(--mut)", fontSize: 13 }}>No organisational units yet — add a top-level unit to get started.</p>
          ) : (
            // GAP-ADMIN-ORG-04: a plain nested list with real expand/collapse buttons and
            // unit-named action labels. role="tree" was dropped: it promises arrow-key
            // navigation this page does not implement, and the valid minimal fix is a list.
            <ul aria-label="Organisation hierarchy" style={{ margin: 0, padding: 0 }}>
              {tree.map((node) => (
                <OrgTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  editingId={editingId}
                  addingChildOf={addingChildOf}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  onStartRename={setEditingId}
                  onCancelRename={() => setEditingId(null)}
                  onRename={(id, name) => void handleRename(id, name)}
                  onStartMove={(id) => { setMoveError(null); setNotice(null); setMovingId(id); setMoveTarget(units.find((u) => u.id === id)?.parentId ?? ""); }}
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
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--mut)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: TYPE_COLORS[t], display: "inline-block" }} aria-hidden="true" />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* GAP-ADMIN-ORG-03: reparenting moves a whole subtree, so it is confirmed first. tenant-service has no delete/deactivate
          route and PATCH takes no reason, so neither is offered here. */}
      <ConfirmDialog
        open={movingUnit !== undefined}
        title={movingUnit ? `Move ${movingUnit.name}?` : ""}
        description="Moving a unit changes where it and everything beneath it sit in the organisation tree. The change is queued when you confirm and appears in the tree shortly after."
        confirmLabel="Move"
        busy={busy}
        errorMessage={moveError ?? undefined}
        confirmDisabled={movingUnit ? (movingUnit.parentId ?? "") === moveTarget : true}
        onConfirm={() => void handleMove()}
        onCancel={() => setMovingId(null)}
      >
        <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
          New parent
          <select className="input" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }}>
            <option value="">(top level)</option>
            {units
              .filter((u) => !blockedParents.has(u.id))
              .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </ConfirmDialog>
    </div>
  );
}
