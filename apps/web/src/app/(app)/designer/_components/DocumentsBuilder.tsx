"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, EmptyState } from "@/app/_components/ds";
import {
  LocaleTabs,
  SortableList,
  type LocaleKey,
} from "@/app/_components/ds/designer";
import {
  DOCUMENT_FORMAT_OPTIONS,
  newDocumentRow,
  slugifyDocType,
  type DocumentsDesignState,
  type RequiredDocumentUi,
} from "@/app/_components/ds/designer/documentTypes";
import {
  documentsUiToApi,
  documentsWithWarnings,
  persistDocumentsDesign,
} from "../_data/documentBuilderApi";
import type { WorkflowLane } from "../_data/workflowConstants";

interface Props {
  initial: DocumentsDesignState;
  lanes: WorkflowLane[];
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: DocumentsDesignState) => void;
}

function CitizenUploadChip({ doc }: { doc: RequiredDocumentUi }) {
  const label = doc.labels.en || doc.labels.hi || "Document";
  return (
    <div
      aria-label="Citizen upload preview"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: "var(--r-sm)",
        border: "1px dashed var(--line2)",
        background: "var(--bg)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}{doc.mandatory ? " *" : ""}</div>
      <div style={{ color: "var(--mut)" }}>
        {doc.formats.map((f) => f.toUpperCase()).join(", ")} · max {doc.maxSizeMb} MB
      </div>
    </div>
  );
}

export function DocumentsBuilder({
  initial,
  lanes,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.documents[0]?.id ?? null);
  const [locale, setLocale] = useState<LocaleKey>("en");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const verificationLanes = useMemo(
    () => lanes.filter((l) => l.enabled && l.key !== "submitted" && l.key !== "issued"),
    [lanes],
  );

  const laneKeys = useMemo(() => verificationLanes.map((l) => l.key), [verificationLanes]);

  const rowsWithWarnings = useMemo(
    () => documentsWithWarnings(design.documents, laneKeys),
    [design.documents, laneKeys],
  );

  const selected = design.documents.find((d) => d.id === selectedId);

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistDocumentsDesign(latest.current);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onDesignPersisted, onSaveState]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const updateDoc = (id: string, patch: Partial<RequiredDocumentUi>) => {
    setDesign((d) => ({
      documents: d.documents.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const addDoc = () => {
    const row = newDocumentRow();
    setDesign((d) => ({ documents: [...d.documents, row] }));
    setSelectedId(row.id);
  };

  const move = (id: string, dir: -1 | 1) => {
    setDesign((d) => {
      const idx = d.documents.findIndex((r) => r.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= d.documents.length) return d;
      const docs = [...d.documents];
      [docs[idx], docs[next]] = [docs[next]!, docs[idx]!];
      return { documents: docs };
    });
  };

  const toggleFormat = (id: string, fmt: RequiredDocumentUi["formats"][number]) => {
    const doc = design.documents.find((d) => d.id === id);
    if (!doc) return;
    const formats = doc.formats.includes(fmt)
      ? doc.formats.filter((f) => f !== fmt)
      : [...doc.formats, fmt];
    updateDoc(id, { formats: formats.length ? formats : ["pdf"] });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Card title="Required documents">
        {design.documents.length === 0 ? (
          <EmptyState
            icon="📄"
            title="No documents yet"
            message="Most services need at least one supporting document. Add what applicants must upload."
            action={<button type="button" className="btn primary" onClick={addDoc}>Add document</button>}
          />
        ) : (
          <>
            <SortableList
              items={design.documents}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMoveUp={(id) => move(id, -1)}
              onMoveDown={(id) => move(id, 1)}
              ariaLabel="Document checklist"
              renderItem={(item) => {
                const w = rowsWithWarnings.find((r) => r.doc.id === item.id)?.warning;
                return (
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.labels.en || item.labels.hi || "Untitled"}</div>
                    <div style={{ fontSize: 12, color: "var(--mut)" }}>
                      {item.mandatory ? "Mandatory" : "Optional"}
                      {item.verifiedAtLane ? ` · verified at ${item.verifiedAtLane}` : ""}
                    </div>
                    {w ? (
                      <div style={{ fontSize: 12, color: "var(--warn-fg)", marginTop: 4 }}>{w}</div>
                    ) : null}
                  </div>
                );
              }}
            />
            <button type="button" className="btn ghost" onClick={addDoc} style={{ marginTop: 12 }}>+ Add document</button>
          </>
        )}
      </Card>

      <Card title={selected ? "Edit document" : "Select a document"}>
        {selected ? (
          <>
            <LocaleTabs
              active={locale}
              onChange={setLocale}
              completeness={{ en: Boolean(selected.labels.en.trim()), hi: Boolean(selected.labels.hi.trim()) }}
            />
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Name</span>
              <input
                value={selected.labels[locale]}
                onChange={(e) => {
                  const labels = { ...selected.labels, [locale]: e.target.value };
                  const docType = selected.docType || slugifyDocType(labels.en || labels.hi);
                  updateDoc(selected.id, { labels, docType });
                }}
                style={{ width: "100%" }}
              />
            </label>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--mut)", display: "block", marginBottom: 4 }}>Formats</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DOCUMENT_FORMAT_OPTIONS.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className={selected.formats.includes(fmt.id) ? "btn primary" : "btn ghost"}
                    onClick={() => toggleFormat(selected.id, fmt.id)}
                    style={{ fontSize: 12, padding: "2px 10px" }}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Max size (MB)</span>
              <input
                type="number"
                min={1}
                max={50}
                value={selected.maxSizeMb}
                onChange={(e) => updateDoc(selected.id, { maxSizeMb: Number(e.target.value) || 5 })}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={selected.mandatory}
                onChange={(e) => updateDoc(selected.id, { mandatory: e.target.checked })}
              />
              Mandatory
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Verified at (approval lane)</span>
              <select
                value={selected.verifiedAtLane}
                onChange={(e) => updateDoc(selected.id, { verifiedAtLane: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="">— not linked —</option>
                {verificationLanes.map((lane) => (
                  <option key={lane.id} value={lane.key}>{lane.name}</option>
                ))}
              </select>
            </label>
            <CitizenUploadChip doc={selected} />
          </>
        ) : (
          <p style={{ color: "var(--mut)" }}>Select a document from the list to edit it.</p>
        )}
      </Card>
    </div>
  );
}

export { documentsUiToApi };
