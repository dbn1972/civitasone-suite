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
import { useFormError } from "@/lib/useFormError";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Button, ConfirmDialog, EmptyState, Segmented } from "../../../../_components/ds";
import {
  listCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  toDraft,
  blankDraft,
  validateDraft,
  fieldTypeHasOptions,
  looksSensitive,
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

/**
 * Roles selectable as "who may see a sensitive field's value in the clear".
 * Mirrors the CRM admin/PII role set (lib/auth/roleGuard CRM_PII_READ_ROLES) but
 * declared locally — this is a "use client" component and must not import
 * roleGuard (which pulls in next/headers). The server remains the authority for
 * actually stripping values; this list only drives the definition UI.
 */
const VISIBILITY_ROLE_OPTIONS = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"] as const;

interface Row extends CustomFieldDraft {
  key: string;
  /** The field type as last persisted, to warn when a saved field's type changes (GAP-CRM-CUSTOM-FIELDS-02). */
  origFieldType?: CfFieldType;
}
let SEQ = 0;
function toRow(d: CustomFieldDraft): Row {
  return { ...d, key: d.id ?? `new-${SEQ++}`, origFieldType: d.id ? d.fieldType : undefined };
}

export function CustomFieldsManager() {
  const t = useTranslations("crmCustomFieldsManager");
  const [entity, setEntity] = useState<CfEntityType>("leads");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<CfSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("custom field");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  /** A saved row whose field-type change is awaiting confirmation (GAP-CRM-CUSTOM-FIELDS-02). */
  const [typeChangeKey, setTypeChangeKey] = useState<string | null>(null);
  /** Typed field-name confirmation for a destructive delete (GAP-CRM-CUSTOM-FIELDS-04). */
  const [deleteNameInput, setDeleteNameInput] = useState("");
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

  // Stable per-option React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale. An option is a plain string (no room for its own
  // id), so a parallel id list *per row* (keyed by the row's own already-
  // stable `.key`, a Record since rows themselves come and go) stands in for
  // one -- seeded whenever a row's options first appear (on load() and
  // addRow(), in lockstep with rows itself) and kept in step by
  // addOption/removeOption below.
  const nextOptionRowId = useRef(0);
  const [optionRowIds, setOptionRowIds] = useState<Record<string, number[]>>({});
  const optionKeyFor = (rowKey: string, idx: number) => optionRowIds[rowKey]?.[idx] ?? idx;

  async function load(entityType: CfEntityType, gen: number) {
    setSource("loading");
    const { data, source: s } = await listCustomFields(entityType);
    // Skip if the admin switched entity type (or the component unmounted) since
    // this load began — otherwise a stale reload would present one entity's
    // catalogue as live fact while a different one is selected.
    if (!mountedRef.current || gen !== genRef.current) return;
    const nextRows = data.map((f) => toRow(toDraft(f)));
    setRows(nextRows);
    setOptionRowIds(
      Object.fromEntries(nextRows.map((r) => [r.key, r.options.map(() => nextOptionRowId.current++)])),
    );
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
    const row = toRow(blankDraft(entity, rows.length));
    setRows((prev) => [...prev, row]);
    setOptionRowIds((ids) => ({ ...ids, [row.key]: row.options.map(() => nextOptionRowId.current++) }));
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
    setOptionRowIds((ids) => ({ ...ids, [key]: [...(ids[key] ?? []), nextOptionRowId.current++] }));
  }
  function removeOption(key: string, idx: number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, options: r.options.filter((_, i) => i !== idx) } : r)),
    );
    setOptionRowIds((ids) => ({ ...ids, [key]: (ids[key] ?? []).filter((_, i) => i !== idx) }));
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
    // GAP-CRM-CUSTOM-FIELDS-02: changing a saved field's type can invalidate
    // values already captured on records — confirm before persisting.
    if (row.id && row.origFieldType !== undefined && row.origFieldType !== row.fieldType) {
      setTypeChangeKey(row.key);
      return;
    }
    await doSave(row);
  }

  /**
   * Poll the catalogue until the saved field is reflected, then set the success
   * line. Save is a 202 (queue-backed) write, so the row may not appear on the
   * first reload — the copy says "submitted" and the local draft is kept
   * meanwhile, never claiming "saved" over a stale list (GAP-CRM-CUSTOM-FIELDS-03).
   */
  async function reloadUntilReflected(row: Row, gen: number): Promise<boolean> {
    const delays = [500, 1000, 2000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const { data, source } = await listCustomFields(entity);
      if (gen !== genRef.current || !mountedRef.current) return false;
      if (source === "error") return false;
      const name = row.fieldName.trim().toLowerCase();
      const present = row.id
        ? data.some((f) => f.id === row.id && f.fieldType === row.fieldType)
        : data.some((f) => f.fieldName.trim().toLowerCase() === name);
      if (present) {
        const nextRows = data.map((f) => toRow(toDraft(f)));
        setRows(nextRows);
        setOptionRowIds(
          Object.fromEntries(nextRows.map((r) => [r.key, r.options.map(() => nextOptionRowId.current++)])),
        );
        setSource(source);
        return true;
      }
      if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    return false;
  }

  async function doSave(row: Row) {
    const gen = genRef.current;
    setBusyKey(row.key);
    try {
      if (row.id) await updateCustomField(row.id, row);
      else await createCustomField(row);
      if (gen !== genRef.current) return;
      const reflected = await reloadUntilReflected(row, gen);
      if (gen !== genRef.current) return;
      setMessage(
        reflected
          ? t("savedMessage", { name: row.fieldName.trim() })
          : t("submittedMessage", { name: row.fieldName.trim() }),
      );
    } catch (e) {
      setError(formError.fromException("save", e).message);
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
      setError(formError.fromException("save", e).message);
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;
  const typeChangeRow = rows.find((r) => r.key === typeChangeKey) ?? null;

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
                        onChange={(e) => {
                          const fieldName = e.target.value;
                          // Default sensitive ON the first time a PII-looking
                          // name is entered; never force it back off (the admin
                          // can untick deliberately). GAP-CRM-CUSTOM-FIELDS-01.
                          const patch: Partial<Row> = { fieldName };
                          if (!row.sensitive && looksSensitive(fieldName)) patch.sensitive = true;
                          update(row.key, patch);
                        }}
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
                      {row.id && row.origFieldType !== undefined && row.origFieldType !== row.fieldType ? (
                        <span role="alert" style={{ fontSize: 12, color: "#b45309" }}>
                          {t("typeChangeWarning")}
                        </span>
                      ) : null}
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
                            <div key={optionKeyFor(row.key, idx)} style={{ display: "flex", gap: 8 }}>
                              <input
                                value={opt}
                                onChange={(e) => setOption(row.key, idx, e.target.value)}
                                style={inputStyle}
                                aria-label={`Option ${idx + 1}`}
                                aria-invalid={errors.options ? true : undefined}
                                aria-describedby={errors.options ? optErrId : undefined}
                              />
                              <Button type="button" variant="ghost" style={{ minHeight: 36 }} onClick={() => removeOption(row.key, idx)} aria-label={`Remove option ${idx + 1}`}>
                                Remove
                              </Button>
                            </div>
                          ))
                        )}
                        <div>
                          <Button type="button" variant="ghost" style={{ minHeight: 36 }} onClick={() => addOption(row.key)}>
                            + Add option
                          </Button>
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
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={row.sensitive}
                        onChange={(e) => update(row.key, { sensitive: e.target.checked })}
                        aria-label={t("sensitiveLabel")}
                      />
                      {t("sensitiveLabel")}
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

                  {looksSensitive(row.fieldName) ? (
                    <p role="alert" style={{ fontSize: 12, color: "#b45309", margin: "8px 0 0" }}>
                      {t("sensitiveWarning")}
                    </p>
                  ) : null}

                  {row.sensitive ? (
                    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, margin: "8px 0 0", padding: "6px 10px 10px" }}>
                      <legend style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>
                        {t("visibleToRolesLegend")}
                      </legend>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} aria-label={t("visibleToRolesGroupLabel")}>
                        {VISIBILITY_ROLE_OPTIONS.map((roleName) => {
                          const checked = row.visibleToRoles.includes(roleName);
                          return (
                            <label key={roleName} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                aria-label={t("visibleToRole", { role: roleName })}
                                onChange={(e) =>
                                  update(row.key, {
                                    visibleToRoles: e.target.checked
                                      ? [...row.visibleToRoles, roleName]
                                      : row.visibleToRoles.filter((r) => r !== roleName),
                                  })
                                }
                              />
                              {roleName}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button type="button" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => save(row)}>
                      {busyKey === row.key ? "Saving…" : "Save"}
                    </Button>
                    <Button type="button" variant="danger" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => { setDeleteNameInput(""); setConfirmKey(row.key); }}>
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {source !== "error" && source !== "loading" ? (
          <div>
            <Button type="button" variant="ghost" style={{ minHeight: 40 }} onClick={addRow}>
              + Add custom field
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmKey !== null}
        title="Delete this custom field?"
        description={
          confirmRow ? (
            <>
              <p style={{ margin: "0 0 8px" }}>
                {t("deleteDescription", { name: confirmRow.fieldName || t("newFieldName"), entity: ENTITY_TYPE_LABELS[entity].toLowerCase() })}
              </p>
              {confirmRow.id ? (
                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span>{t.rich("typeNameToConfirm", { name: confirmRow.fieldName, strong: (chunks) => <strong>{chunks}</strong> })}</span>
                  <input
                    value={deleteNameInput}
                    onChange={(e) => setDeleteNameInput(e.target.value)}
                    aria-label={t("typeNameAria")}
                    style={inputStyle}
                  />
                </label>
              ) : null}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete"
        danger
        busy={busyKey === confirmKey}
        blockConfirm={!!confirmRow?.id && deleteNameInput.trim() !== (confirmRow?.fieldName ?? "").trim()}
        onConfirm={() => confirmRow && doDelete(confirmRow)}
        onCancel={() => { setConfirmKey(null); setDeleteNameInput(""); }}
      />

      <ConfirmDialog
        open={typeChangeKey !== null}
        title={t("typeChangeTitle")}
        description={
          typeChangeRow
            ? t("typeChangeDescription", {
                name: typeChangeRow.fieldName,
                from: FIELD_TYPE_LABELS[typeChangeRow.origFieldType ?? typeChangeRow.fieldType],
                to: FIELD_TYPE_LABELS[typeChangeRow.fieldType],
              })
            : ""
        }
        confirmLabel={t("typeChangeConfirm")}
        danger
        busy={busyKey === typeChangeKey}
        onConfirm={() => {
          if (!typeChangeRow) return;
          setTypeChangeKey(null);
          void doSave(typeChangeRow);
        }}
        onCancel={() => setTypeChangeKey(null)}
      />
    </div>
  );
}
