"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
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
import { persistFormDesign } from "../_data/formBuilderApi";
import {
  FIELD_VIRTUALIZE_THRESHOLD,
  PALETTE_DRAG_MIME,
  addFieldToSection,
  addSection,
  fieldReferenceCount,
  moveFieldToSection,
  moveFieldWithinSection,
  moveSection,
  removeDanglingVisibility,
  removeSection,
  renameSection,
  toggleSectionCollapsed,
  totalFieldCount,
} from "../_data/formBuilderModel";

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
  const [activeSectionId, setActiveSectionId] = useState<string>(initial.sections[0]?.id ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dropTargetSectionId, setDropTargetSectionId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ field: FormFieldDefinition; sectionId: string; index: number } | null>(null);
  // GAP-DESIGNER-DETAIL-B2-05: store the undo-toast timeout so a second delete or
  // an unmount clears it (the old code never cleared it).
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Field pending a confirm because other fields reference it in visibility rules.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;
  // GAP-DESIGNER-DETAIL-B2-01: track the last design we actually persisted, so a
  // save's replace() does not re-trigger the autosave effect every ~2s with no edit.
  const lastPersisted = useRef<FormDesignState | null>(null);

  const selectedField = selectedFieldId ? design.fields[selectedFieldId] : null;
  const allFieldsList = useMemo(() => Object.values(design.fields), [design.fields]);
  const fieldTotal = totalFieldCount(design);
  const activeSection = design.sections.find((s) => s.id === activeSectionId) ?? design.sections[0];

  useEffect(() => {
    if (!design.sections.some((s) => s.id === activeSectionId) && design.sections[0]) {
      setActiveSectionId(design.sections[0].id);
    }
  }, [design.sections, activeSectionId]);

  const commit = useCallback((next: FormDesignState) => {
    push(next);
    setRevision((r) => r + 1);
  }, [push]);

  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // GAP-DESIGNER-DETAIL-B2-01: skip if nothing changed since the last persist,
    // so replace(saved) does not re-arm this effect in a loop.
    if (lastPersisted.current && JSON.stringify(lastPersisted.current) === JSON.stringify(latest.current)) {
      return;
    }
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistFormDesign(latest.current, serviceKey, serviceName);
        lastPersisted.current = saved;
        replace(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [onSaveState, onDesignPersisted, replace, serviceKey, serviceName]);

  // GAP-DESIGNER-DETAIL-B2-01: flush any pending save on unmount rather than dropping it.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void persistFormDesign(latest.current, serviceKey, serviceName).catch(() => {});
    }
    // GAP-DESIGNER-DETAIL-B2-05: clear the undo-toast timer on unmount.
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
  }, [serviceKey, serviceName]);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const addField = (type: DesignerFieldType, sectionId?: string) => {
    const sid = sectionId ?? activeSection?.id;
    if (!sid) return;
    const result = addFieldToSection(design, type, sid);
    if (!result) return;
    commit(result.design);
    setActiveSectionId(sid);
    setSelectedFieldId(result.field.id);
  };

  const updateField = (fieldId: string, patch: Partial<FormFieldDefinition>) => {
    const existing = design.fields[fieldId];
    if (!existing) return;
    commit({ ...design, fields: { ...design.fields, [fieldId]: { ...existing, ...patch } } });
  };

  const duplicateField = (fieldId: string) => {
    const src = design.fields[fieldId];
    if (!src) return;
    const result = addFieldToSection(design, src.type, src.sectionId);
    if (!result) return;
    const dup: FormFieldDefinition = {
      ...src,
      ...result.field,
      id: result.field.id,
      apiName: `${src.apiName}_copy`.slice(0, 48),
      label: `${src.label} (copy)`,
      metadataFieldId: undefined,
    };
    const section = result.design.sections.find((s) => s.id === src.sectionId);
    if (!section) return;
    const idx = section.fieldIds.indexOf(src.id);
    // addFieldToSection appended; move copy next to source
    const withoutTail = section.fieldIds.filter((id) => id !== dup.id);
    const fieldIds = [...withoutTail];
    fieldIds.splice(idx + 1, 0, dup.id);
    commit({
      ...result.design,
      fields: { ...result.design.fields, [dup.id]: dup },
      sections: result.design.sections.map((s) =>
        s.id === src.sectionId ? { ...s, fieldIds } : s,
      ),
    });
    setSelectedFieldId(dup.id);
  };

  const performDelete = (fieldId: string) => {
    const field = design.fields[fieldId];
    if (!field) return;
    const section = design.sections.find((s) => s.id === field.sectionId);
    const index = section?.fieldIds.indexOf(fieldId) ?? -1;
    const { [fieldId]: _, ...rest } = design.fields;
    // GAP-DESIGNER-DETAIL-B2-05: strip visibility conditions that pointed at the
    // deleted field so the saved rule set is not left dangling.
    const cleaned = removeDanglingVisibility(
      {
        ...design,
        fields: rest,
        sections: design.sections.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((id) => id !== fieldId) })),
      },
      fieldId,
    );
    commit(cleaned);
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    if (section && index >= 0) {
      setUndoToast({ field, sectionId: section.id, index });
      // Clear any previous toast timer before starting a new one.
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoToast(null), 8000);
    }
  };

  const deleteField = (fieldId: string) => {
    const field = design.fields[fieldId];
    if (!field) return;
    // GAP-DESIGNER-DETAIL-B2-05: if other fields reference this one in their
    // visibility rules, confirm before the fast delete. Otherwise delete + Undo.
    if (fieldReferenceCount(design, fieldId) > 0) {
      setConfirmDeleteId(fieldId);
      return;
    }
    performDelete(fieldId);
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

  const onPaletteDragStart = (e: DragEvent, type: DesignerFieldType) => {
    e.dataTransfer.setData(PALETTE_DRAG_MIME, type);
    e.dataTransfer.setData("text/plain", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onSectionDragOver = (e: DragEvent, sectionId: string) => {
    if (![...e.dataTransfer.types].includes(PALETTE_DRAG_MIME) && ![...e.dataTransfer.types].includes("text/plain")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTargetSectionId(sectionId);
  };

  const onSectionDrop = (e: DragEvent, sectionId: string) => {
    e.preventDefault();
    const type = (e.dataTransfer.getData(PALETTE_DRAG_MIME) || e.dataTransfer.getData("text/plain")) as DesignerFieldType;
    setDropTargetSectionId(null);
    if (!type || !FIELD_PALETTE_GROUPS.flatMap((g) => g.items).some((i) => i.type === type)) return;
    addField(type, sectionId);
  };

  const leftPane = previewOpen ? (
    <SplitPreview open={previewOpen} onToggle={() => setPreviewOpen(false)} revision={revision}>
      <FormRenderer design={design} />
    </SplitPreview>
  ) : (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Field palette</h3>
        <Button variant="ghost" onClick={() => setPreviewOpen(true)}>Preview</Button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>
        Click or drag a field onto a section. New fields go to{" "}
        <strong style={{ color: "var(--ink2)" }}>{activeSection?.label ?? "the active section"}</strong>
        {" "}({fieldTotal} field{fieldTotal === 1 ? "" : "s"} total).
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {FIELD_PALETTE_GROUPS.map((group) => (
          <div key={group.label}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>{group.label}</p>
            <div style={{ display: "grid", gap: 6 }}>
              {group.items.map((item) => (
                <Button
                  key={item.type}
                  variant="ghost"
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, item.type)}
                  style={{ justifyContent: "flex-start", display: "flex", gap: 10, alignItems: "center", cursor: "grab" }}
                  onClick={() => addField(item.type)}
                  aria-label={`Add ${item.label} field`}
                >
                  <span aria-hidden style={{ width: 28, textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                </Button>
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
          <span>Field &quot;{undoToast.field.label}&quot; deleted</span>
          <Button variant="ghost" onClick={undoDelete}>Undo</Button>
        </div>
      ) : null}

      {/* GAP-DESIGNER-DETAIL-B2-05: confirm when deleting a field referenced by other
          fields' visibility rules — lists the affected fields so the designer knows
          which conditions will also be removed. */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete field?"
        description={
          confirmDeleteId
            ? `This field is used in visibility conditions by ${fieldReferenceCount(design, confirmDeleteId)} other field(s). Deleting it will remove those conditions too.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) performDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />

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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
              {design.sections.length} section{design.sections.length === 1 ? "" : "s"}
              {fieldTotal >= FIELD_VIRTUALIZE_THRESHOLD
                ? " · large forms window the field list for smooth scrolling"
                : null}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                const next = addSection(design, `Section ${design.sections.length + 1}`);
                commit(next);
                const created = next.sections[next.sections.length - 1];
                if (created) setActiveSectionId(created.id);
              }}
            >
              Add section
            </Button>
          </div>

          {design.sections.map((section, sectionIndex) => {
            const items = section.fieldIds
              .map((id) => design.fields[id])
              .filter((f): f is FormFieldDefinition => !!f);
            const isDropTarget = dropTargetSectionId === section.id;
            const isActive = activeSection?.id === section.id;

            return (
              <div
                key={section.id}
                role="button"
                tabIndex={0}
                onDragOver={(e) => onSectionDragOver(e, section.id)}
                onDragLeave={() => setDropTargetSectionId((cur) => (cur === section.id ? null : cur))}
                onDrop={(e) => onSectionDrop(e, section.id)}
                onClick={() => setActiveSectionId(section.id)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    setActiveSectionId(section.id);
                  }
                }}
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: "var(--r-sm)",
                  border: isDropTarget
                    ? "2px dashed var(--primary)"
                    : isActive
                      ? "1px solid var(--primary)"
                      : "1px solid var(--line)",
                  background: isDropTarget ? "var(--primary-soft)" : "var(--panel)",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <Button
                    variant="ghost"
                    aria-expanded={!section.collapsed}
                    aria-label={section.collapsed ? "Expand section" : "Collapse section"}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(toggleSectionCollapsed(design, section.id));
                    }}
                    style={{ padding: "2px 8px", minWidth: 32 }}
                  >
                    {section.collapsed ? "▸" : "▾"}
                  </Button>
                  <input
                    className="input"
                    value={section.label}
                    onChange={(e) => commit(renameSection(design, section.id, e.target.value))}
                    onFocus={() => setActiveSectionId(section.id)}
                    aria-label="Section title"
                    style={{ fontWeight: 600, maxWidth: 280, flex: 1 }}
                  />
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {items.length} field{items.length === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="ghost"
                    aria-label="Move section up"
                    disabled={sectionIndex === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(moveSection(design, section.id, -1));
                    }}
                    style={{ padding: "2px 8px" }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Move section down"
                    disabled={sectionIndex === design.sections.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(moveSection(design, section.id, 1));
                    }}
                    style={{ padding: "2px 8px" }}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={design.sections.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(removeSection(design, section.id));
                    }}
                    title={design.sections.length <= 1 ? "Keep at least one section" : "Remove section (fields move to the first section)"}
                  >
                    Remove
                  </Button>
                </div>

                {section.collapsed ? (
                  <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>
                    Section collapsed — expand to edit fields, or drop a palette field here.
                  </p>
                ) : items.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--mut)", fontSize: 13 }}>
                    No fields yet — pick a type from the palette or drag one here.
                  </p>
                ) : (
                  <SortableList
                    items={items}
                    selectedId={selectedFieldId}
                    onSelect={(id) => {
                      setSelectedFieldId(id);
                      setActiveSectionId(section.id);
                    }}
                    onMoveUp={(id) => commit(moveFieldWithinSection(design, section.id, id, -1))}
                    onMoveDown={(id) => commit(moveFieldWithinSection(design, section.id, id, 1))}
                    virtualizeThreshold={FIELD_VIRTUALIZE_THRESHOLD}
                    ariaLabel={`${section.label} fields`}
                    itemAccessibleName={(field) => field.label}
                    renderItem={(field) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, flexWrap: "wrap" }}>
                        <span aria-hidden>{typeIcon(field.type)}</span>
                        <span>{field.label}</span>
                        {field.required ? <span aria-label="Required" style={{ color: "var(--bad)" }}>*</span> : null}
                        {field.visibility?.length ? <span aria-label="Conditional" title="Has visibility rule">◆</span> : null}
                        {(field.type === "address" || field.type === "ward") ? (
                          <span style={{ fontSize: 11, color: "var(--info)", padding: "2px 6px", background: "var(--infobg)", borderRadius: 999 }}>
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

              {design.sections.length > 1 ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Section</span>
                  <select
                    className="input"
                    value={selectedField.sectionId}
                    onChange={(e) => {
                      commit(moveFieldToSection(design, selectedField.id, e.target.value));
                      setActiveSectionId(e.target.value);
                    }}
                  >
                    {design.sections.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}

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
                <Button variant="ghost" onClick={() => duplicateField(selectedField.id)}>Duplicate</Button>
                <Button variant="ghost" onClick={() => deleteField(selectedField.id)}>Delete field</Button>
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
