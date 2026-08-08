/** Pure FormBuilder (B2) model helpers — no I/O. */

import {
  defaultLabelForType,
  slugifyApiName,
  type DesignerFieldType,
  type FormDesignState,
  type FormFieldDefinition,
  type FormSectionDefinition,
} from "@/app/_components/ds/designer/formTypes";

/** UX §9: virtualize field list beyond 50. */
export const FIELD_VIRTUALIZE_THRESHOLD = 50;

export const PALETTE_DRAG_MIME = "application/x-civitas-palette-field";

export function createSection(label = "New section"): FormSectionDefinition {
  return {
    id: crypto.randomUUID(),
    label,
    collapsed: false,
    fieldIds: [],
  };
}

export function createFieldDefinition(type: DesignerFieldType, sectionId: string): FormFieldDefinition {
  const id = crypto.randomUUID();
  const label = defaultLabelForType(type);
  return {
    id,
    apiName: slugifyApiName(label, id),
    type,
    label,
    required: false,
    sectionId,
    choices: type === "picklist_single" || type === "picklist_multi" ? ["Option 1", "Option 2"] : undefined,
    fileTypes: type === "file" ? ["pdf", "jpg", "png"] : undefined,
    fileMaxMb: type === "file" ? 5 : undefined,
  };
}

export function totalFieldCount(design: FormDesignState): number {
  return Object.keys(design.fields).length;
}

export function addFieldToSection(
  design: FormDesignState,
  type: DesignerFieldType,
  sectionId: string,
): { design: FormDesignState; field: FormFieldDefinition } | null {
  if (!design.sections.some((s) => s.id === sectionId)) return null;
  const field = createFieldDefinition(type, sectionId);
  return {
    field,
    design: {
      ...design,
      fields: { ...design.fields, [field.id]: field },
      sections: design.sections.map((s) =>
        s.id === sectionId ? { ...s, fieldIds: [...s.fieldIds, field.id], collapsed: false } : s,
      ),
    },
  };
}

export function addSection(design: FormDesignState, label?: string): FormDesignState {
  return { ...design, sections: [...design.sections, createSection(label)] };
}

export function renameSection(design: FormDesignState, sectionId: string, label: string): FormDesignState {
  return {
    ...design,
    sections: design.sections.map((s) => (s.id === sectionId ? { ...s, label } : s)),
  };
}

export function toggleSectionCollapsed(design: FormDesignState, sectionId: string): FormDesignState {
  return {
    ...design,
    sections: design.sections.map((s) =>
      s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s,
    ),
  };
}

export function moveSection(design: FormDesignState, sectionId: string, direction: -1 | 1): FormDesignState {
  const idx = design.sections.findIndex((s) => s.id === sectionId);
  const next = idx + direction;
  if (idx < 0 || next < 0 || next >= design.sections.length) return design;
  const sections = [...design.sections];
  [sections[idx], sections[next]] = [sections[next]!, sections[idx]!];
  return { ...design, sections };
}

/** Removes a section; orphan fields move into the first remaining section. */
export function removeSection(design: FormDesignState, sectionId: string): FormDesignState {
  if (design.sections.length <= 1) return design;
  const victim = design.sections.find((s) => s.id === sectionId);
  if (!victim) return design;
  const remaining = design.sections.filter((s) => s.id !== sectionId);
  const target = remaining[0]!;
  const fields = { ...design.fields };
  for (const fid of victim.fieldIds) {
    const f = fields[fid];
    if (f) fields[fid] = { ...f, sectionId: target.id };
  }
  return {
    ...design,
    fields,
    sections: remaining.map((s) =>
      s.id === target.id
        ? { ...s, fieldIds: [...s.fieldIds, ...victim.fieldIds] }
        : s,
    ),
  };
}

export function moveFieldWithinSection(
  design: FormDesignState,
  sectionId: string,
  fieldId: string,
  direction: -1 | 1,
): FormDesignState {
  return {
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
  };
}

export function moveFieldToSection(
  design: FormDesignState,
  fieldId: string,
  targetSectionId: string,
): FormDesignState {
  const field = design.fields[fieldId];
  if (!field || field.sectionId === targetSectionId) return design;
  if (!design.sections.some((s) => s.id === targetSectionId)) return design;
  return {
    ...design,
    fields: { ...design.fields, [fieldId]: { ...field, sectionId: targetSectionId } },
    sections: design.sections.map((s) => {
      if (s.id === field.sectionId) {
        return { ...s, fieldIds: s.fieldIds.filter((id) => id !== fieldId) };
      }
      if (s.id === targetSectionId) {
        return { ...s, fieldIds: [...s.fieldIds, fieldId], collapsed: false };
      }
      return s;
    }),
  };
}

/** Window indices for a fixed-row-height virtual list (no external virtualizer). */
export function visibleWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): { start: number; end: number; paddingTop: number; paddingBottom: number } {
  if (itemCount <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(itemCount, start + visible);
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (itemCount - end) * rowHeight),
  };
}

export function shouldVirtualizeFields(fieldCount: number, threshold = FIELD_VIRTUALIZE_THRESHOLD): boolean {
  return fieldCount >= threshold;
}
