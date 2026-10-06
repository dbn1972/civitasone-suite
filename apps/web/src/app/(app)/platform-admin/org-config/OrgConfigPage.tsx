"use client";

import { useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useFormError } from "@/lib/useFormError";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import { tint, validateOrgLevels } from "@/lib/orgLevels";
import type { OrgHierarchyLevel } from "@/app/_data/loaders";

/* ─── Types ─────────────────────────────────────────────────────────── */
type OrgLevel = OrgHierarchyLevel;

function badge(color: string, text: string) {
  return (
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: tint(color, 0.1), color, border: `1px solid ${tint(color, 0.25)}` }}>
      {text}
    </span>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", color: "var(--ink)", boxSizing: "border-box" as const };

/* ─── Editable org-level list ───────────────────────────────────────── */
// COMP-014: levels are the tenant's REAL configured hierarchy-level taxonomy
// from GET /v1/admin/org-hierarchy-levels (admin-service), saved via the
// matching PUT with res.ok checked. See git history for the full rationale.
export function OrgConfigPage({ initialLevels, source }: { initialLevels: OrgLevel[]; source: "api" | "error" }) {
  const [levels, setLevels] = useState<OrgLevel[]>(initialLevels);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrgLevel | null>(null);
  const [draftError, setDraftError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  const formError = useFormError("org hierarchy");

  // GAP-PLATFORM-ADMIN-ORG-CONFIG-03: dirty tracking + unsaved-changes guard.
  const baseline = useRef<string>(JSON.stringify(initialLevels));
  const dirty = useMemo(
    () => JSON.stringify(levels) !== baseline.current,
    [levels],
  );
  useUnsavedChangesGuard(dirty || editId !== null);

  // Drag state (progressive enhancement; buttons are the accessible path).
  const dragIndex = useRef<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // GAP-PLATFORM-ADMIN-ORG-CONFIG-01: single reorder primitive reused by both
  // drag-and-drop and the keyboard-accessible Move up/down buttons.
  function moveLevel(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= levels.length || to >= levels.length) return;
    setLevels((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      const renumbered = copy.map((l, idx) => ({ ...l, order: idx + 1 }));
      setNotice(`"${moved.label}" moved to position ${to + 1}.`);
      return renumbered;
    });
  }

  function onDragStart(i: number) { dragIndex.current = i; setDragging(i); }
  function onDragEnter(i: number) { dragOverIndex.current = i; setDragOver(i); }
  function onDragEnd() {
    const from = dragIndex.current;
    const to = dragOverIndex.current;
    if (from !== null && to !== null) moveLevel(from, to);
    dragIndex.current = null;
    dragOverIndex.current = null;
    setDragging(null);
    setDragOver(null);
  }

  function startEdit(level: OrgLevel) {
    setEditId(level.id);
    setDraft({ ...level });
    setError("");
    setDraftError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditId(null);
    setDraft(null);
    setError("");
    setDraftError("");
  }

  function saveEdit() {
    if (!draft) return;
    // GAP-PLATFORM-ADMIN-ORG-CONFIG-06: validate the draft against the whole
    // set (length bounds + case-insensitive unique labels), not just a
    // non-empty name.
    const candidate = levels.map((l) => (l.id === draft.id ? draft : l));
    const result = validateOrgLevels(candidate);
    if (!result.ok) { setDraftError(result.message); return; }
    setLevels(candidate);
    setEditId(null);
    setDraft(null);
    setNotice(`"${draft.label.trim()}" updated. Click Save order to persist.`);
  }

  async function persistOrder() {
    // Re-validate before sending (defence in depth).
    const result = validateOrgLevels(levels);
    if (!result.ok) { setError(result.message); setConfirmSave(false); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/admin/org-hierarchy-levels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          levels: levels.map((l) => ({
            id: l.id, order: l.order, label: l.label,
            description: l.description, examples: l.examples, color: l.color,
          })),
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      baseline.current = JSON.stringify(levels);
      setNotice("Org hierarchy saved.");
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
      setConfirmSave(false);
    }
  }

  return (
    <div>
      <DataSourceBadge source={source} message="Couldn't load the org hierarchy configuration — showing nothing" />
      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--good, #027a48)", marginBottom: 12, padding: "8px 12px", background: "var(--goodbg, #ecfdf3)", borderRadius: 8 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 12.5, color: "var(--bad, #b42318)", marginBottom: 12 }}>{error}</p>
      ) : null}

      {/* Hierarchy table */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Indian Government Org Structure</h3>
            {dirty && <span className="pill warn" style={{ fontSize: 11 }}>Unsaved changes</span>}
          </div>
          <Button size="sm" onClick={() => setConfirmSave(true)} disabled={busy || levels.length === 0}>
            {busy ? "Saving…" : "Save order"}
          </Button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0, padding: "0 16px 10px" }}>
          Use the Move up / Move down buttons (or drag rows) to reorder reporting levels. Click Edit to rename or update descriptions.
        </p>

        {levels.length === 0 ? (
          <p style={{ padding: 16, color: "var(--ink3, var(--ink2))", fontSize: 13 }}>
            {source === "error" ? "Couldn't load the org hierarchy configuration." : "No hierarchy levels configured yet."}
          </p>
        ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: "var(--line2, #f8fafc)", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "10px 16px", textAlign: "start", fontWeight: 650, fontSize: 12, color: "var(--ink2)", width: 96 }}>Reorder</th>
                <th style={{ padding: "10px 16px", textAlign: "start", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Level</th>
                <th style={{ padding: "10px 16px", textAlign: "start", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Name</th>
                <th style={{ padding: "10px 16px", textAlign: "start", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Description</th>
                <th style={{ padding: "10px 16px", textAlign: "start", fontWeight: 650, fontSize: 12, color: "var(--ink2)" }}>Examples</th>
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
                      transition: "background 0.1s",
                    }}
                  >
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={i === 0 || isEditing}
                          aria-label={`Move ${level.label} up`}
                          onClick={() => moveLevel(i, i - 1)}
                          style={{ fontSize: 12, padding: "2px 8px" }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={i === levels.length - 1 || isEditing}
                          aria-label={`Move ${level.label} down`}
                          onClick={() => moveLevel(i, i + 1)}
                          style={{ fontSize: 12, padding: "2px 8px" }}
                        >
                          ↓
                        </Button>
                      </div>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {badge(level.color, `L${level.order}`)}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {isEditing ? (
                        <>
                          <input style={inp} value={draft?.label ?? ""} onChange={(e) => setDraft((d) => d ? { ...d, label: e.target.value } : d)} aria-label="Level name" aria-invalid={!!draftError} aria-describedby={draftError ? `org-draft-error-${level.id}` : undefined} />
                          {draftError && <span id={`org-draft-error-${level.id}`} role="alert" style={{ display: "block", fontSize: 11.5, color: "var(--bad, #b42318)", marginTop: 4 }}>{draftError}</span>}
                        </>
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
                          <Button size="sm" onClick={saveEdit} style={{ fontSize: 12 }}>Save</Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit} style={{ fontSize: 12 }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => startEdit(level)} style={{ fontSize: 12 }}>Edit</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Reporting chain preview */}
      <div className="card">
        <div className="card-h"><h3 style={{ margin: 0 }}>Reporting chain preview</h3></div>
        <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {levels.map((level, i) => (
            <div key={level.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ padding: "10px 18px", borderRadius: 10, background: tint(level.color, 0.1), border: `1.5px solid ${tint(level.color, 0.3)}`, textAlign: "center", minWidth: 100 }}>
                <div style={{ fontSize: 11, color: level.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>L{level.order}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: level.color }}>{level.label}</div>
              </div>
              {i < levels.length - 1 && (
                <span style={{ color: "var(--ink2)", fontSize: 20, lineHeight: 1 }} aria-hidden="true">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title="Save org hierarchy order?"
        description="This will update the organisation hierarchy configuration for your tenant. Existing units are not renamed or deleted."
        confirmLabel="Save order"
        busy={busy}
        onConfirm={() => void persistOrder()}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  );
}
