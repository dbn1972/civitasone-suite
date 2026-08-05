"use client";
/**
 * CustomFieldsManager — config UI for the crm-service custom-fields module
 * (Req 8.8). An entity-type selector switches between the leads / contacts /
 * deals catalogues; each catalogue is a list of editable definition cards
 * (inline edit) plus an "add" affordance for new definitions. A select /
 * multi-select field type reveals an options editor. Every definition is
 * created / updated via 202 mutations and the list is reloaded after each
 * change.
 *
 * A failed load shows the saved-info badge and never fabricates an empty
 * catalogue as fact. fieldName is a required field: it is marked
 * aria-required / aria-invalid with a role="alert" error, and save is blocked
 * (also blocked when a select field has no options). Delete goes through
 * ConfirmDialog.
 */
import { useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { ConfirmDialog, EmptyState, Segmented } from "../../../../_components/ds";
import {
  listCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  toDraft,
  blankDraft,
  validateDraft,
  fieldTypeHasOptions,
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  type CfEntityType,
  type CfFieldType,
  type CfSource,
  type CustomFieldDraft,
} from "@/lib/crm/customFields";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface Row extends CustomFieldDraft {
  key: string;
}
let SEQ = 0;
function toRow(d: CustomFieldDraft): Row {
  return { ...d, key: d.id ?? `new-${SEQ++}` };
}

export function CustomFieldsManager() {
  const [entity, setEntity] = useState<CfEntityType>("leads");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<CfSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();
  const errBaseId = useId();

  // Generation counter bumped on every entity switch; a reload only applies
  // its result while its generation is still current. mountedRef guards
  // handler-initiated reloads that resolve after unmount.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function load(entityType: CfEntityType, gen: number) {
    setSource("loading");
    const { data, source: s } = await listCustomFields(entityType);
    // Skip if the admin switched entity type (or the component unmounted) since
    // this load began — otherwise a stale reload would present one entity's
    // catalogue as live fact while a different one is selected.
    if (!mountedRef.current || gen !== genRef.current) return;
    setRows(data.map((f) => toRow(toDraft(f))));
    setSource(s);
  }
  useEffect(() => {
    const gen = (genRef.current += 1);
    setMessage("");
    setError("");
    void load(entity, gen);
  }, [entity]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, toRow(blankDraft(entity, prev.length))]);
  }
  function setOption(key: string, idx: number, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const options = r.options.slice();
        options[idx] = value;
        return { ...r, options };
      }),
    );
  }
  function addOption(key: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, options: [...r.options, ""] } : r)));
  }
  function removeOption(key: string, idx: number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, options: r.options.filter((_, i) => i !== idx) } : r)),
    );
  }

  async function save(row: Row) {
    setMessage("");
    setError("");
    setAttempted((a) => ({ ...a, [row.key]: true }));
    const errors = validateDraft(row);
    if (Object.keys(errors).length > 0) {
      setError(errors.fieldName ?? errors.options ?? "Fix the highlighted fields.");
      return;
    }
    const gen = genRef.current;
    setBusyKey(row.key);
    try {
      if (row.id) await updateCustomField(row.id, row);
      else await createCustomField(row);
      // If the admin switched entity type during the mutation, the switch
      // effect now owns the view — don't overwrite it with this entity's data.
      if (gen !== genRef.current) return;
      setMessage(`Custom field “${row.fieldName.trim()}” saved.`);
      await load(entity, gen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the custom field.");
    } finally {
      setBusyKey(null);
    }
  }

  async function doDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    const gen = genRef.current;
    setBusyKey(row.key);
    setError("");
    try {
      await deleteCustomField(row.id);
      setConfirmKey(null);
      // Skip the reload if the entity type changed mid-delete (see save()).
      if (gen !== genRef.current) return;
      setMessage(`Custom field “${row.fieldName}” deleted.`);
      await load(entity, gen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the custom field.");
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 id={headingId}>Custom fields</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div role="group" aria-label="Entity type">
          <Segmented
            options={ENTITY_TYPES.map((e) => ENTITY_TYPE_LABELS[e])}
            value={ENTITY_TYPE_LABELS[entity]}
            onChange={(label) => {
              const next = ENTITY_TYPES.find((e) => ENTITY_TYPE_LABELS[e] === label);
              if (next) setEntity(next);
            }}
          />
        </div>

        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}

        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading custom fields…</p>
        ) : source === "error" ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            — Custom fields unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🧩"
            title="No custom fields yet"
            message={`Add the first custom field for ${ENTITY_TYPE_LABELS[entity].toLowerCase()} below.`}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }} aria-label="Custom fields">
            {rows.map((row) => {
              const errors = attempted[row.key] ? validateDraft(row) : {};
              const nameErrId = `${errBaseId}-name-${row.key}`;
              const optErrId = `${errBaseId}-opt-${row.key}`;
              const showOptions = fieldTypeHasOptions(row.fieldType);
              return (
                <li key={row.key} className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--line)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Field name</span>
                      <input
                        value={row.fieldName}
                        onChange={(e) => update(row.key, { fieldName: e.target.value })}
                        style={inputStyle}
                        aria-label="Custom field name"
                        aria-required="true"
                        aria-invalid={errors.fieldName ? true : undefined}
                        aria-describedby={errors.fieldName ? nameErrId : undefined}
                      />
                      {errors.fieldName ? (
                        <span id={nameErrId} role="alert" style={{ fontSize: 12, color: "#b42318" }}>{errors.fieldName}</span>
                      ) : null}
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Type</span>
                      <select
                        value={row.fieldType}
                        onChange={(e) => update(row.key, { fieldType: e.target.value as CfFieldType })}
                        style={inputStyle}
                        aria-label="Custom field type"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {showOptions ? (
                    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, margin: "10px 0 0", padding: "6px 10px 10px" }}>
                      <legend style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>Options</legend>
                      <div style={{ display: "grid", gap: 8 }} aria-label="Custom field options">
                        {row.options.length === 0 ? (
                          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>No options yet — add at least one.</p>
                        ) : (
                          row.options.map((opt, idx) => (
                            <div key={idx} style={{ display: "flex", gap: 8 }}>
                              <input
                                value={opt}
                                onChange={(e) => setOption(row.key, idx, e.target.value)}
                                style={inputStyle}
                                aria-label={`Option ${idx + 1}`}
                                aria-invalid={errors.options ? true : undefined}
                                aria-describedby={errors.options ? optErrId : undefined}
                              />
                              <button type="button" className="btn ghost" style={{ minHeight: 36 }} onClick={() => removeOption(row.key, idx)} aria-label={`Remove option ${idx + 1}`}>
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                        <div>
                          <button type="button" className="btn ghost" style={{ minHeight: 36 }} onClick={() => addOption(row.key)}>
                            + Add option
                          </button>
                        </div>
                        {errors.options ? (
                          <span id={optErrId} role="alert" style={{ fontSize: 12, color: "#b42318" }}>{errors.options}</span>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <input type="checkbox" checked={row.required} onChange={(e) => update(row.key, { required: e.target.checked })} />
                      Required
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <span style={{ color: "var(--muted)" }}>Order</span>
                      <input
                        type="number"
                        min={0}
                        value={row.ordinal}
                        onChange={(e) => update(row.key, { ordinal: Number(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: 80 }}
                        aria-label="Display order"
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn primary" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => save(row)}>
                      {busyKey === row.key ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="btn danger" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {source !== "error" && source !== "loading" ? (
          <div>
            <button type="button" className="btn ghost" style={{ minHeight: 40 }} onClick={addRow}>
              + Add custom field
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmKey !== null}
        title="Delete this custom field?"
        description={
          confirmRow
            ? `“${confirmRow.fieldName || "(new field)"}” will be removed from ${ENTITY_TYPE_LABELS[entity].toLowerCase()}. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        busy={busyKey === confirmKey}
        onConfirm={() => confirmRow && doDelete(confirmRow)}
        onCancel={() => setConfirmKey(null)}
      />
    </div>
  );
}
