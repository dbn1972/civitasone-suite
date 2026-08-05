"use client";
/**
 * SftpIngestionConfig — the lead-ingestion settings for the `sftp` connector
 * (BRD §9 #12). Rendered inside IntegrationDrawer when provider is sftp; the
 * draft it edits is lifted into the drawer so it saves through the existing
 * connector save path (the drawer merges buildSftpConfigPatch() into the PUT
 * payload). All logic (validation, mapping transforms) lives in
 * lib/admin/sftpIngestion so it stays unit-testable.
 */
import { useId } from "react";
import {
  LEAD_FIELDS,
  LEAD_FIELD_LABELS,
  newMappingRow,
  validateIngestionConfig,
  type IngestionConfigDraft,
  type MappingRow,
} from "@/lib/admin/sftpIngestion";

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "9px 12px",
  fontSize: 13.5,
  background: "var(--panel)",
  color: "var(--ink)",
};

export function SftpIngestionConfig({
  draft,
  onChange,
}: {
  draft: IngestionConfigDraft;
  onChange: (next: IngestionConfigDraft) => void;
}) {
  const uid = useId();
  const errors = validateIngestionConfig(draft);

  const labelId = `${uid}-label`;
  const labelErrId = `${uid}-label-err`;
  const mapErrId = `${uid}-map-err`;

  function patch(p: Partial<IngestionConfigDraft>) {
    onChange({ ...draft, ...p });
  }
  function setRow(idx: number, row: Partial<MappingRow>) {
    const mapping = draft.mapping.map((r, i) => (i === idx ? { ...r, ...row } : r));
    patch({ mapping });
  }
  function addRow() {
    patch({ mapping: [...draft.mapping, newMappingRow()] });
  }
  function removeRow(idx: number) {
    patch({ mapping: draft.mapping.filter((_, i) => i !== idx) });
  }

  return (
    <fieldset
      style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12, margin: 0 }}
    >
      <legend style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", padding: "0 6px" }}>
        Lead ingestion
      </legend>

      {/* inbound path */}
      <Field label="Inbound path" htmlFor={`${uid}-inbound`} help="Remote directory the sweeper reads new files from.">
        <input
          id={`${uid}-inbound`}
          type="text"
          value={draft.inboundPath}
          placeholder="/inbound/leads"
          onChange={(e) => patch({ inboundPath: e.target.value })}
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {/* file pattern */}
      <Field label="File pattern" htmlFor={`${uid}-pattern`} help="Glob of files to pick up, e.g. *.csv">
        <input
          id={`${uid}-pattern`}
          type="text"
          value={draft.filePattern}
          placeholder="*.csv"
          onChange={(e) => patch({ filePattern: e.target.value })}
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {/* archive path (optional) */}
      <Field label="Archive path" htmlFor={`${uid}-archive`} help="Optional: processed files are moved here.">
        <input
          id={`${uid}-archive`}
          type="text"
          value={draft.archivePath}
          placeholder="/archive/leads"
          onChange={(e) => patch({ archivePath: e.target.value })}
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {/* lead source toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={draft.leadSource}
          onChange={(e) => patch({ leadSource: e.target.checked })}
        />
        Promote imported rows to CRM leads
      </label>

      {/* lead source label — required when leadSource is on */}
      {draft.leadSource && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label id={labelId} htmlFor={`${uid}-src-label`} style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
            Lead source label<span style={{ color: "var(--bad)" }}> *</span>
          </label>
          <input
            id={`${uid}-src-label`}
            type="text"
            value={draft.leadSourceLabel}
            placeholder="SFTP import — Partner X"
            onChange={(e) => patch({ leadSourceLabel: e.target.value })}
            autoComplete="off"
            aria-required="true"
            aria-invalid={errors.leadSourceLabel ? true : undefined}
            aria-describedby={errors.leadSourceLabel ? labelErrId : undefined}
            style={{ ...inputStyle, borderColor: errors.leadSourceLabel ? "var(--bad)" : "var(--line)" }}
          />
          {errors.leadSourceLabel && (
            <span id={labelErrId} role="alert" style={{ fontSize: 11.5, color: "var(--bad)" }}>
              {errors.leadSourceLabel}
            </span>
          )}
        </div>
      )}

      {/* column mapping editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
          Column mapping
          {draft.leadSource && <span style={{ color: "var(--bad)" }}> *</span>}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--mut)" }}>
          Map each file column to a lead field. When lead ingestion is on, at least one
          column must map to Email or Mobile.
        </span>

        {draft.mapping.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--mut)" }}>No columns mapped yet.</span>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.mapping.map((row, idx) => {
              const rowKey = row.id ?? `row-${idx}`;
              const colId = `${uid}-col-${rowKey}`;
              const fieldId = `${uid}-field-${rowKey}`;
              return (
                <li key={rowKey} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    id={colId}
                    type="text"
                    aria-label={`File column ${idx + 1}`}
                    value={row.column}
                    placeholder="File column"
                    onChange={(e) => setRow(idx, { column: e.target.value })}
                    autoComplete="off"
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                  <span aria-hidden style={{ color: "var(--mut)" }}>→</span>
                  <select
                    id={fieldId}
                    aria-label={`Lead field for column ${idx + 1}`}
                    value={row.field}
                    onChange={(e) => setRow(idx, { field: e.target.value as MappingRow["field"] })}
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  >
                    {LEAD_FIELDS.map((f) => (
                      <option key={f} value={f}>{LEAD_FIELD_LABELS[f]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn ghost sm"
                    aria-label={`Remove mapping ${idx + 1}`}
                    onClick={() => removeRow(idx)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div>
          <button type="button" className="btn ghost sm" onClick={addRow}>
            + Add column mapping
          </button>
        </div>

        {errors.mapping && (
          <span id={mapErrId} role="alert" aria-live="polite" style={{ fontSize: 11.5, color: "var(--bad)" }}>
            {errors.mapping}
          </span>
        )}
      </div>
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
        {label}
      </label>
      {children}
      {help && <span style={{ fontSize: 11.5, color: "var(--mut)" }}>{help}</span>}
    </div>
  );
}
