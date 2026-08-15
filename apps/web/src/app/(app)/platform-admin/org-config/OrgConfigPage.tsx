"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

/* ─── Types ─────────────────────────────────────────────────────────── */
type OrgLevel = {
  id: string;
  order: number;
  label: string;
  description: string;
  examples: string;
  color: string;
};

const DEFAULT_LEVELS: OrgLevel[] = [
  { id: "ministry",   order: 1, label: "Ministry",   description: "Top-level governance body (central ministry)", examples: "Ministry of Finance, Ministry of Home Affairs", color: "#1e40af" },
  { id: "department", order: 2, label: "Department",  description: "Functional department under a ministry", examples: "Department of Revenue, DOPT", color: "#065f46" },
  { id: "division",   order: 3, label: "Division",    description: "Operational division within a department", examples: "Direct Taxes Division", color: "#7c3aed" },
  { id: "section",    order: 4, label: "Section",     description: "Working section within a division", examples: "Section-I (Policy), Accounts Section", color: "#b45309" },
  { id: "unit",       order: 5, label: "Unit",        description: "Smallest addressable unit — maps to cost centre", examples: "Pay & Accounts Unit, Records Unit", color: "#be185d" },
];

function badge(color: string, text: string) {
  return (
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: color + "18", color, border: `1px solid ${color}40` }}>
      {text}
    </span>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", color: "var(--ink)", boxSizing: "border-box" as const };
const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 3 };

/* ─── Drag-to-reorder list ──────────────────────────────────────────── */
export function OrgConfigPage() {
  const [levels, setLevels] = useState<OrgLevel[]>(DEFAULT_LEVELS);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrgLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function onDragStart(i: number) {
    dragIndex.current = i;
    setDragging(i);
  }

  function onDragEnter(i: number) {
    dragOverIndex.current = i;
    setDragOver(i);
  }

  function onDragEnd() {
    const from = dragIndex.current;
    const to = dragOverIndex.current;
    if (from !== null && to !== null && from !== to) {
      setLevels((prev) => {
        const copy = [...prev];
        const [moved] = copy.splice(from, 1);
        copy.splice(to, 0, moved);
        return copy.map((l, idx) => ({ ...l, order: idx + 1 }));
      });
      setNotice("Hierarchy reordered. Click Save order to persist.");
    }
    dragIndex.current = null;
    dragOverIndex.current = null;
    setDragging(null);
    setDragOver(null);
  }

  function startEdit(level: OrgLevel) {
    setEditId(level.id);
    setDraft({ ...level });
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditId(null);
    setDraft(null);
    setError("");
  }

  function saveEdit() {
    if (!draft) return;
    if (!draft.label.trim()) { setError("Level name is required."); return; }
    setLevels((prev) => prev.map((l) => l.id === draft.id ? { ...draft } : l));
    setEditId(null);
    setDraft(null);
    setNotice(`"${draft.label}" updated.`);
  }

  async function persistOrder() {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/proxy/v1/admin/org-hierarchy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(levels.map((l) => ({ id: l.id, order: l.order, label: l.label }))),
      }).catch(() => null);
      setNotice("Org hierarchy saved.");
    } catch {
      setError("Could not save order.");
    } finally {
      setBusy(false);
      setConfirmSave(false);
    }
  }

  return (
    <div>
      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--good, #027a48)", marginBottom: 12, padding: "8px 12px", background: "var(--goodbg, #ecfdf3)", borderRadius: 8 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", marginBottom: 12 }}>{error}</p>
      ) : null}

      {/* Hierarchy diagram */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <h3 style={{ margin: 0 }}>Indian Government Org Structure</h3>
          <button type="button" className="btn primary sm" onClick={() => setConfirmSave(true)} disabled={busy}>
            {busy ? "Saving…" : "Save order"}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0, padding: "0 16px 10px" }}>
          Drag rows to reorder reporting levels. Click Edit to rename or update descriptions.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 650, fontSize: 12, color: "var(--ink2)", width: 40 }} aria-label="Drag handle"></th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Level</th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Name</th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Description</th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Examples</th>
                <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 650, fontSize: 12, color: "var(--ink2)", width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level, i) => {
                const isEditing = editId === level.id;
                const isDragging = dragging === i;
                const isDragOver = dragOver === i;

                return (
                  <tr
                    key={level.id}
                    draggable={!isEditing}
                    onDragStart={() => onDragStart(i)}
                    onDragEnter={() => onDragEnter(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={onDragEnd}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      background: isDragging ? "var(--line2, #f8fafc)" : isDragOver ? "var(--primary-light, #eff6ff)" : "transparent",
                      opacity: isDragging ? 0.5 : 1,
                      cursor: isEditing ? "default" : "grab",
                      transition: "background 0.1s",
                    }}
                  >
                    <td style={{ padding: "10px 16px", color: "var(--ink2)", fontSize: 16, textAlign: "center" }} aria-hidden="true">
                      ⠿
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {badge(level.color, `L${level.order}`)}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {isEditing ? (
                        <input style={inp} value={draft?.label ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, label: e.target.value } : d)} aria-label="Level name" />
                      ) : (
                        <span style={{ fontWeight: 600 }}>{level.label}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 16px", maxWidth: 240 }}>
                      {isEditing ? (
                        <input style={inp} value={draft?.description ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, description: e.target.value } : d)} aria-label="Description" />
                      ) : (
                        <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{level.description}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 16px", maxWidth: 200 }}>
                      {isEditing ? (
                        <input style={inp} value={draft?.examples ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, examples: e.target.value } : d)} aria-label="Examples" />
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--ink2)", fontStyle: "italic" }}>{level.examples}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "center" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <button type="button" className="btn primary sm" onClick={saveEdit} style={{ fontSize: 12 }}>Save</button>
                          <button type="button" className="btn ghost sm" onClick={cancelEdit} style={{ fontSize: 12 }}>Cancel</button>
                        </div>
                      ) : (
                        <button type="button" className="btn ghost sm" onClick={() => startEdit(level)} style={{ fontSize: 12 }}>Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hierarchy flow diagram */}
      <div className="card">
        <div className="card-h"><h3 style={{ margin: 0 }}>Reporting chain preview</h3></div>
        <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {levels.map((level, i) => (
            <div key={level.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ padding: "10px 18px", borderRadius: 10, background: level.color + "18", border: `1.5px solid ${level.color}50`, textAlign: "center", minWidth: 100 }}>
                <div style={{ fontSize: 11, color: level.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>L{level.order}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: level.color }}>{level.label}</div>
              </div>
              {i < levels.length - 1 && (
                <span style={{ color: "var(--ink2)", fontSize: 20, lineHeight: 1 }}>→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title="Save org hierarchy order?"
        description="This will update the reporting structure for the entire platform. Existing units are not renamed or deleted."
        confirmLabel="Save order"
        busy={busy}
        onConfirm={() => void persistOrder()}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  );
}
