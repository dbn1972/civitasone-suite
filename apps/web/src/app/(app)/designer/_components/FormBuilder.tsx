"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  ConditionBuilder,
  FormRenderer,
  PropertyPanel,
  SortableList,
  SplitPreview,
  useUndoRedo,
  FIELD_PALETTE_GROUPS,
  VALIDATION_PRESETS,
  type DesignerFieldType,
  type FormDesignState,
  type FormFieldDefinition,
  type ValidationPresetId,
} from "@/app/_components/ds/designer";
import { createField, persistFormDesign } from "../_data/formBuilderApi";

interface Props {
  serviceKey: string;
  serviceName: string;
  initial: FormDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: FormDesignState) => void;
}

export function FormBuilder({
  serviceKey,
  serviceName,
  initial,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const { state: design, push, replace } = useUndoRedo<FormDesignState>(initial);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [undoToast, setUndoToast] = useState<{ field: FormFieldDefinition; sectionId: string; index: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  const selectedField = selectedFieldId ? design.fields[selectedFieldId] : null;
  const allFieldsList = useMemo(() => Object.values(design.fields), [design.fields]);

  const commit = useCallback((next: FormDesignState) => {
    push(next);
    setRevision((r) => r + 1);
  }, [push]);

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistFormDesign(latest.current, serviceKey, serviceName);
        replace(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onSaveState, onDesignPersisted, replace, serviceKey, serviceName]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const addField = (type: DesignerFieldType) => {
    const sid = design.sections[0]?.id;
    if (!sid) return;
    const field = createField(type, sid);
    commit({
      ...design,
      fields: { ...design.fields, [field.id]: field },
      sections: design.sections.map((s) =>
        s.id === sid ? { ...s, fieldIds: [...s.fieldIds, field.id] } : s,
      ),
    });
    setSelectedFieldId(field.id);
  };

  const updateField = (fieldId: string, patch: Partial<FormFieldDefinition>) => {
    const existing = design.fields[fieldId];
    if (!existing) return;
    commit({ ...design, fields: { ...design.fields, [fieldId]: { ...existing, ...patch } } });
  };

  const duplicateField = (fieldId: string) => {
    const src = design.fields[fieldId];
    if (!src) return;
    const copy = createField(src.type, src.sectionId);
    const dup: FormFieldDefinition = {
      ...src,
      ...copy,
      id: copy.id,
      apiName: `${src.apiName}_copy`.slice(0, 48),
      label: `${src.label} (copy)`,
      metadataFieldId: undefined,
    };
    const section = design.sections.find((s) => s.id === src.sectionId);
    if (!section) return;
    const idx = section.fieldIds.indexOf(fieldId);
    const fieldIds = [...section.fieldIds];
    fieldIds.splice(idx + 1, 0, dup.id);
    commit({
      ...design,
      fields: { ...design.fields, [dup.id]: dup },
      sections: design.sections.map((s) => (s.id === src.sectionId ? { ...s, fieldIds } : s)),
    });
    setSelectedFieldId(dup.id);
  };

  const deleteField = (fieldId: string) => {
    const field = design.fields[fieldId];
    if (!field) return;
    const section = design.sections.find((s) => s.id === field.sectionId);
    const index = section?.fieldIds.indexOf(fieldId) ?? -1;
    const { [fieldId]: _, ...rest } = design.fields;
    commit({
      ...design,
      fields: rest,
      sections: design.sections.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((id) => id !== fieldId) })),
    });
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    if (section && index >= 0) {
      setUndoToast({ field, sectionId: section.id, index });
      setTimeout(() => setUndoToast(null), 8000);
    }
  };

  const undoDelete = () => {
    if (!undoToast) return;
    const { field, sectionId, index } = undoToast;
    commit({
      ...design,
      fields: { ...design.fields, [field.id]: field },
      sections: design.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const fieldIds = [...s.fieldIds];
        fieldIds.splice(index, 0, field.id);
        return { ...s, fieldIds };
      }),
    });
    setUndoToast(null);
    setSelectedFieldId(field.id);
  };

  const moveField = (sectionId: string, fieldId: string, direction: -1 | 1) => {
    commit({
      ...design,
      sections: design.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const idx = s.fieldIds.indexOf(fieldId);
        const next = idx + direction;
        if (idx < 0 || next < 0 || next >= s.fieldIds.length) return s;
        const fieldIds = [...s.fieldIds];
        [fieldIds[idx], fieldIds[next]] = [fieldIds[next]!, fieldIds[idx]!];
        return { ...s, fieldIds };
      }),
    });
  };

  const leftPane = previewOpen ? (
    <SplitPreview open={previewOpen} onToggle={() => setPreviewOpen(false)} revision={revision}>
      <FormRenderer design={design} />
    </SplitPreview>
  ) : (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Field palette</h3>
        <button type="button" className="btn ghost" onClick={() => setPreviewOpen(true)}>Preview</button>
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        {FIELD_PALETTE_GROUPS.map((group) => (
          <div key={group.label}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>{group.label}</p>
            <div style={{ display: "grid", gap: 6 }}>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="btn ghost"
                  style={{ justifyContent: "flex-start", display: "flex", gap: 10, alignItems: "center" }}
                  onClick={() => addField(item.type)}
                >
                  <span aria-hidden style={{ width: 28, textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {undoToast ? (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
          }}
        >
          <span>Field deleted — Undo</span>
          <button type="button" className="btn ghost" onClick={undoDelete}>Undo</button>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 240px) 1fr minmax(220px, 280px)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Card padding>{leftPane}</Card>

        <Card title="Form canvas" padding>
          {design.sections.map((section) => {
            const items = section.fieldIds
              .map((id) => design.fields[id])
              .filter((f): f is FormFieldDefinition => !!f);

            return (
              <div key={section.id} style={{ marginBottom: 20 }}>
                <input
                  className="input"
                  value={section.label}
                  onChange={(e) => {
                    commit({
                      ...design,
                      sections: design.sections.map((s) =>
                        s.id === section.id ? { ...s, label: e.target.value } : s,
                      ),
                    });
                  }}
                  aria-label="Section title"
                  style={{ fontWeight: 600, maxWidth: 280, marginBottom: 8 }}
                />
                {items.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>
                    No fields yet — pick a type from the palette.
                  </p>
                ) : (
                  <SortableList
                    items={items}
                    selectedId={selectedFieldId}
                    onSelect={setSelectedFieldId}
                    onMoveUp={(id) => moveField(section.id, id, -1)}
                    onMoveDown={(id) => moveField(section.id, id, 1)}
                    renderItem={(field) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
                        <span aria-hidden>{typeIcon(field.type)}</span>
                        <span>{field.label}</span>
                        {field.required ? <span aria-label="Required" style={{ color: "var(--bad-fg)" }}>*</span> : null}
                        {field.visibility?.length ? <span aria-label="Conditional" title="Has visibility rule">👁</span> : null}
                        {(field.type === "address" || field.type === "ward") ? (
                          <span style={{ fontSize: 11, color: "var(--info-fg)", padding: "2px 6px", background: "var(--info-bg)", borderRadius: 999 }}>
                            bound to: {field.type === "ward" ? "ULB ward list" : "location hierarchy"}
                          </span>
                        ) : null}
                      </span>
                    )}
                  />
                )}
              </div>
            );
          })}
        </Card>

        <PropertyPanel selected={!!selectedField}>
          {selectedField ? (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Label</span>
                <input className="input" value={selectedField.label} onChange={(e) => updateField(selectedField.id, { label: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Help text</span>
                <input className="input" value={selectedField.helpText ?? ""} onChange={(e) => updateField(selectedField.id, { helpText: e.target.value })} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={selectedField.required} onChange={(e) => updateField(selectedField.id, { required: e.target.checked })} />
                Required
              </label>

              {(selectedField.type === "picklist_single" || selectedField.type === "picklist_multi") ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Choices (one per line)</span>
                  <textarea
                    className="input"
                    rows={4}
                    value={(selectedField.choices ?? []).join("\n")}
                    onChange={(e) =>
                      updateField(selectedField.id, {
                        choices: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </label>
              ) : null}

              {selectedField.type === "number" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Min</span>
                    <input className="input" type="number" value={selectedField.numberMin ?? ""} onChange={(e) => updateField(selectedField.id, { numberMin: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Max</span>
                    <input className="input" type="number" value={selectedField.numberMax ?? ""} onChange={(e) => updateField(selectedField.id, { numberMax: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </label>
                </div>
              ) : null}

              {selectedField.type === "file" ? (
                <>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Allowed types</span>
                    <input className="input" value={(selectedField.fileTypes ?? []).join(", ")} onChange={(e) => updateField(selectedField.id, { fileTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Max size (MB)</span>
                    <input className="input" type="number" min={1} value={selectedField.fileMaxMb ?? 5} onChange={(e) => updateField(selectedField.id, { fileMaxMb: Number(e.target.value) })} />
                  </label>
                </>
              ) : null}

              {(selectedField.type === "text" || selectedField.type.startsWith("profile_")) ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Validation preset</span>
                  <select
                    className="input"
                    value={selectedField.validation?.preset ?? ""}
                    onChange={(e) =>
                      updateField(selectedField.id, {
                        validation: e.target.value ? { preset: e.target.value as ValidationPresetId } : undefined,
                      })
                    }
                  >
                    <option value="">None</option>
                    {VALIDATION_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div>
                <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 13 }}>Visibility</p>
                <ConditionBuilder
                  conditions={selectedField.visibility ?? []}
                  availableFields={allFieldsList}
                  currentFieldId={selectedField.id}
                  onChange={(visibility) => updateField(selectedField.id, { visibility })}
                />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn ghost" onClick={() => duplicateField(selectedField.id)}>Duplicate</button>
                <button type="button" className="btn ghost" onClick={() => deleteField(selectedField.id)}>Delete field</button>
              </div>
            </>
          ) : null}
        </PropertyPanel>
      </div>
    </div>
  );
}

function typeIcon(type: DesignerFieldType): string {
  return FIELD_PALETTE_GROUPS.flatMap((g) => g.items).find((i) => i.type === type)?.icon ?? "•";
}
