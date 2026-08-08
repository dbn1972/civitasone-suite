"use client";

import Link from "next/link";
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
  persistDocumentsDesign,
} from "../_data/documentBuilderApi";
import {
  assessDocumentWarnings,
  buildCitizenUploadPreview,
  documentsLocaleCompleteness,
  laneDisplayName,
  suggestFirstVerificationLane,
  summarizeMandatoryLaneWarnings,
  verificationLanesFromWorkflow,
} from "../_data/documentBuilderModel";
import type { WorkflowLane } from "../_data/workflowConstants";

interface Props {
  initial: DocumentsDesignState;
  lanes: WorkflowLane[];
  /** Service draft id — used for “configure lanes in B4” deep-link. */
  serviceId?: string;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: DocumentsDesignState) => void;
  /** Fired on every local change so the wizard footer can show locale completeness. */
  onDesignChange?: (design: DocumentsDesignState) => void;
}

function CitizenUploadPreview({
  doc,
  locale,
  onLocaleChange,
}: {
  doc: RequiredDocumentUi;
  locale: LocaleKey;
  onLocaleChange: (locale: LocaleKey) => void;
}) {
  const preview = buildCitizenUploadPreview(doc, locale);

  return (
    <div
      data-testid="citizen-upload-preview"
      aria-label="Citizen upload preview"
      style={{
        marginTop: 12,
        borderRadius: "var(--r-md, 10px)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mut)", letterSpacing: 0.02 }}>
          Citizen upload card
        </span>
        <div role="group" aria-label="Preview language" style={{ display: "flex", gap: 4 }}>
          {(["en", "hi"] as LocaleKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={locale === key ? "btn primary" : "btn ghost"}
              onClick={() => onLocaleChange(key)}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {key === "en" ? "EN" : "हिंदी"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <div
            lang={locale}
            style={{ fontWeight: 650, fontSize: 14, color: preview.emptyName ? "var(--mut)" : "var(--ink)" }}
          >
            {preview.label}
            {preview.mandatory ? " *" : ""}
          </div>
          {preview.requiredBadge ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--warn-fg)",
                background: "var(--warn-bg, #fff7ed)",
                border: "1px solid var(--warn-border, #fdba74)",
                borderRadius: 999,
                padding: "1px 8px",
              }}
            >
              {preview.requiredBadge}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "var(--mut)" }}>Optional</span>
          )}
        </div>
        {preview.secondaryLabel ? (
          <div lang={locale === "en" ? "hi" : "en"} style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>
            {preview.secondaryLabel}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 10,
            padding: "18px 12px",
            borderRadius: "var(--r-sm)",
            border: "1px dashed var(--line2)",
            background: "var(--bg)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 10 }}>{preview.dropHint}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" disabled style={{ fontSize: 12, padding: "4px 12px" }}>
              {preview.chooseFileLabel}
            </button>
            {preview.showCameraHint ? (
              <button type="button" className="btn ghost" disabled style={{ fontSize: 12, padding: "4px 12px" }}>
                {preview.cameraLabel}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>
          {preview.formatsLabel} · {preview.maxSizeLabel}
        </div>
      </div>
    </div>
  );
}

export function DocumentsBuilder({
  initial,
  lanes,
  serviceId,
  onSaveState,
  onDesignPersisted,
  onDesignChange,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.documents[0]?.id ?? null);
  const [locale, setLocale] = useState<LocaleKey>("en");
  const [previewLocale, setPreviewLocale] = useState<LocaleKey>("en");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const patchDesign = useCallback((updater: (d: DocumentsDesignState) => DocumentsDesignState) => {
    setDesign((prev) => {
      const next = updater(prev);
      onDesignChange?.(next);
      return next;
    });
  }, [onDesignChange]);

  useEffect(() => {
    onDesignChange?.(initial);
  }, [initial, onDesignChange]);

  const verificationLanes = useMemo(() => verificationLanesFromWorkflow(lanes), [lanes]);
  const laneKeys = useMemo(() => verificationLanes.map((l) => l.key), [verificationLanes]);

  const assessments = useMemo(
    () => assessDocumentWarnings(design.documents, laneKeys),
    [design.documents, laneKeys],
  );

  const warningSummary = useMemo(
    () => summarizeMandatoryLaneWarnings(assessments),
    [assessments],
  );

  const localeMeter = useMemo(
    () => documentsLocaleCompleteness(design.documents),
    [design.documents],
  );

  const suggestedLane = useMemo(
    () => suggestFirstVerificationLane(lanes),
    [lanes],
  );

  const selected = design.documents.find((d) => d.id === selectedId);
  const selectedWarning = assessments.find((r) => r.doc.id === selectedId)?.warning ?? null;

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
    patchDesign((d) => ({
      documents: d.documents.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const addDoc = () => {
    const row = newDocumentRow();
    patchDesign((d) => ({ documents: [...d.documents, row] }));
    setSelectedId(row.id);
  };

  const move = (id: string, dir: -1 | 1) => {
    patchDesign((d) => {
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

  const applySuggestedLane = (id: string) => {
    if (!suggestedLane) return;
    updateDoc(id, { verifiedAtLane: suggestedLane.key });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {warningSummary.banner ? (
        <div
          data-testid="mandatory-lane-warning-banner"
          role="status"
          style={{
            padding: "10px 12px",
            borderRadius: "var(--r-sm)",
            background: "var(--warn-bg, #fff7ed)",
            border: "1px solid var(--warn-border, #fdba74)",
            color: "var(--warn-fg)",
            fontSize: 13,
          }}
        >
          <strong style={{ display: "block", marginBottom: 2 }}>Verification lane warning</strong>
          {warningSummary.banner}
        </div>
      ) : null}

      {!localeMeter.complete && design.documents.length > 0 ? (
        <div
          data-testid="documents-locale-hint"
          role="status"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--r-sm)",
            background: "var(--info-bg, #eff6ff)",
            border: "1px solid var(--info-border, #bfdbfe)",
            color: "var(--ink)",
            fontSize: 12,
          }}
        >
          Locale completeness: {localeMeter.meterLabel}. Add Hindi (and English) names so the
          citizen upload card is bilingual-ready.
        </div>
      ) : null}

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
                  const w = assessments.find((r) => r.doc.id === item.id)?.warning;
                  const laneLabel = item.verifiedAtLane
                    ? laneDisplayName(lanes, item.verifiedAtLane)
                    : "";
                  return (
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {item.labels.en || item.labels.hi || "Untitled"}
                        {!item.labels.hi.trim() || !item.labels.en.trim() ? (
                          <span style={{ marginInlineStart: 6, fontSize: 11, color: "var(--mut)", fontWeight: 500 }}>
                            locale incomplete
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--mut)" }}>
                        {item.mandatory ? "Mandatory" : "Optional"}
                        {laneLabel ? ` · Verified at ${laneLabel}` : ""}
                      </div>
                      {w ? (
                        <div
                          data-testid={`doc-warning-${item.id}`}
                          style={{ fontSize: 12, color: "var(--warn-fg)", marginTop: 4 }}
                        >
                          {w.message}
                        </div>
                      ) : null}
                    </div>
                  );
                }}
              />
              <button type="button" className="btn ghost" onClick={addDoc} style={{ marginTop: 12 }}>
                + Add document
              </button>
            </>
          )}
        </Card>

        <Card title={selected ? "Edit document" : "Select a document"}>
          {selected ? (
            <>
              <LocaleTabs
                active={locale}
                onChange={setLocale}
                completeness={{
                  en: Boolean(selected.labels.en.trim()),
                  hi: Boolean(selected.labels.hi.trim()),
                }}
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
                  lang={locale}
                />
              </label>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: "var(--mut)", display: "block", marginBottom: 4 }}>
                  Formats
                </span>
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

              <div data-testid="verified-at-field" style={{ marginBottom: 12 }}>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>Verified at</span>
                  <select
                    aria-label="Verified at approval lane"
                    value={selected.verifiedAtLane}
                    onChange={(e) => updateDoc(selected.id, { verifiedAtLane: e.target.value })}
                    style={{ width: "100%" }}
                    disabled={verificationLanes.length === 0}
                  >
                    <option value="">— not linked —</option>
                    {verificationLanes.map((lane) => (
                      <option key={lane.id} value={lane.key}>
                        {lane.designationLabel
                          ? `${lane.name} — ${lane.designationLabel}`
                          : lane.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--mut)" }}>
                  Officers see this document on the checklist for the selected approval step.
                </p>
                {verificationLanes.length === 0 ? (
                  <p
                    data-testid="no-verification-lanes"
                    style={{ margin: "8px 0 0", fontSize: 12, color: "var(--warn-fg)" }}
                  >
                    No verifying lanes are enabled in the approval chain.{" "}
                    {serviceId ? (
                      <Link href={`/designer/${serviceId}/b4`} style={{ color: "inherit", textDecoration: "underline" }}>
                        Configure lanes in Workflow
                      </Link>
                    ) : (
                      "Configure lanes in Workflow (B4)."
                    )}
                  </p>
                ) : null}
                {selectedWarning?.kind === "missing_lane" && suggestedLane ? (
                  <button
                    type="button"
                    className="btn ghost"
                    data-testid="suggest-verified-at"
                    onClick={() => applySuggestedLane(selected.id)}
                    style={{ marginTop: 8, fontSize: 12 }}
                  >
                    Link to {suggestedLane.name}
                  </button>
                ) : null}
                {selectedWarning?.kind === "stale_lane" ? (
                  <button
                    type="button"
                    className="btn ghost"
                    data-testid="clear-stale-lane"
                    onClick={() => updateDoc(selected.id, { verifiedAtLane: "" })}
                    style={{ marginTop: 8, fontSize: 12 }}
                  >
                    Clear invalid lane
                  </button>
                ) : null}
                {selectedWarning ? (
                  <p
                    data-testid="selected-doc-warning"
                    role="status"
                    style={{ margin: "8px 0 0", fontSize: 12, color: "var(--warn-fg)" }}
                  >
                    {selectedWarning.message}
                  </p>
                ) : null}
              </div>

              <CitizenUploadPreview
                doc={selected}
                locale={previewLocale}
                onLocaleChange={setPreviewLocale}
              />
            </>
          ) : (
            <p style={{ color: "var(--mut)" }}>Select a document from the list to edit it.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export { documentsUiToApi };
