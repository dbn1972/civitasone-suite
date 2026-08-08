"use client";

import type {
  DesignerFieldType,
  FormDesignState,
  FormFieldDefinition,
  FormSectionDefinition,
  ValidationPreset,
  VisibilityCondition,
} from "@/app/_components/ds/designer/formTypes";
import { visibilityToShowWhen } from "@/app/_components/ds/designer/formTypes";
import { createFieldDefinition } from "./formBuilderModel";

interface MetadataEntity {
  id: string;
  apiName: string;
}

interface MetadataFieldRow {
  id: string;
  apiName: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  picklistValues?: string[] | null;
  validationRule?: Record<string, unknown> | null;
  sortOrder: number;
}

interface MetadataLayoutRow {
  id: string;
  sections: { label: string; columns?: number; fields: string[] }[];
}

interface FormVersionRow {
  id: string;
  visibilityRules: { field: string; showWhen: string }[];
}

async function parseJson(res: Response): Promise<unknown> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function entityApiName(serviceKey: string): string {
  const safe = serviceKey.replace(/[^a-z0-9_]/gi, "_").slice(0, 80);
  return `designer_svc_${safe}`;
}

function mapFieldTypeToMetadata(type: DesignerFieldType): {
  fieldType: string;
  picklistValues?: string[];
} {
  switch (type) {
    case "number":
      return { fieldType: "number" };
    case "date":
      return { fieldType: "date" };
    case "boolean":
      return { fieldType: "boolean" };
    case "picklist_single":
      return { fieldType: "picklist", picklistValues: ["Option 1", "Option 2"] };
    case "picklist_multi":
      return { fieldType: "picklist", picklistValues: ["Option 1", "Option 2"] };
    case "file":
    case "address":
    case "ward":
    case "profile_mobile":
    case "profile_email":
    case "profile_name":
      return { fieldType: "text" };
    default:
      return { fieldType: "text" };
  }
}

function mapMetadataToDesigner(row: MetadataFieldRow, sectionId: string): FormFieldDefinition {
  let type: DesignerFieldType = "text";
  if (row.fieldType === "number") type = "number";
  else if (row.fieldType === "date") type = "date";
  else if (row.fieldType === "boolean") type = "boolean";
  else if (row.fieldType === "picklist") type = "picklist_single";

  const vr = (row.validationRule ?? {}) as Record<string, unknown>;
  const validation: ValidationPreset | undefined =
    typeof vr.preset === "string"
      ? { preset: vr.preset as ValidationPreset["preset"] }
      : undefined;

  return {
    id: row.id,
    apiName: row.apiName,
    type,
    label: row.label,
    required: row.isRequired,
    sectionId,
    choices: row.picklistValues ?? undefined,
    validation,
    metadataFieldId: row.id,
  };
}

export function emptyFormDesign(): FormDesignState {
  const sectionId = crypto.randomUUID();
  return {
    sections: [{ id: sectionId, label: "Application details", fieldIds: [] }],
    fields: {},
  };
}

function parseShowWhen(expr: string, fields: Record<string, FormFieldDefinition>): VisibilityCondition[] {
  const byApi = Object.values(fields);
  const eq = expr.match(/^(\w+)\s*==\s*"([^"]*)"$/);
  if (eq) {
    const src = byApi.find((f) => f.apiName === eq[1]);
    if (src) return [{ sourceFieldId: src.id, operator: "eq", value: eq[2] }];
  }
  const ne = expr.match(/^(\w+)\s*!=\s*"([^"]*)"$/);
  if (ne) {
    const src = byApi.find((f) => f.apiName === ne[1]);
    if (src) return [{ sourceFieldId: src.id, operator: ne[2] === "" ? "not_empty" : "neq", value: ne[2] }];
  }
  return [];
}

export async function loadFormDesign(serviceKey: string, serviceName: string): Promise<FormDesignState> {
  const apiName = entityApiName(serviceKey);
  const entitiesRes = await fetch("/api/proxy/v1/metadata/entities");
  const entitiesPayload = (await parseJson(entitiesRes)) as { data?: MetadataEntity[] };
  let entity = (entitiesPayload.data ?? []).find((e) => e.apiName === apiName);

  if (!entity) {
    const createRes = await fetch("/api/proxy/v1/metadata/entities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiName,
        label: `${serviceName} — Application`,
        pluralLabel: `${serviceName} Applications`,
      }),
    });
    const created = (await parseJson(createRes)) as { data?: { id: string } };
    entity = { id: created.data?.id ?? "", apiName };
  }

  if (!entity?.id) return emptyFormDesign();

  const fieldsRes = await fetch(`/api/proxy/v1/metadata/entities/${entity.id}/fields`);
  const fieldsPayload = (await parseJson(fieldsRes)) as { data?: MetadataFieldRow[] };
  const fieldRows = fieldsPayload.data ?? [];

  const layoutsRes = await fetch(`/api/proxy/v1/metadata/entities/${entity.id}/layouts`);
  const layoutsPayload = (await parseJson(layoutsRes)) as { data?: MetadataLayoutRow[] };
  const layout = layoutsPayload.data?.[0];

  if (!layout) {
    return { ...emptyFormDesign(), entityId: entity.id };
  }

  const fields: Record<string, FormFieldDefinition> = {};
  const sectionMap = new Map<string, FormSectionDefinition>();
  for (const [idx, sec] of layout.sections.entries()) {
    const sid = `section-${idx}`;
    sectionMap.set(sid, { id: sid, label: sec.label, fieldIds: [] });
    for (const api of sec.fields) {
      const row = fieldRows.find((f) => f.apiName === api);
      if (!row) continue;
      const def = mapMetadataToDesigner(row, sid);
      fields[def.id] = def;
      sectionMap.get(sid)!.fieldIds.push(def.id);
    }
  }

  const sections = [...sectionMap.values()];
  let formVersionId: string | undefined;
  const versionsRes = await fetch(`/api/proxy/v1/metadata/forms/${layout.id}/versions?limit=10`);
  if (versionsRes.ok) {
    const versionsPayload = (await versionsRes.json()) as { data?: FormVersionRow[] };
    formVersionId = versionsPayload.data?.[0]?.id;
    for (const rule of versionsPayload.data?.[0]?.visibilityRules ?? []) {
      const target = Object.values(fields).find((f) => f.apiName === rule.field);
      if (target) target.visibility = parseShowWhen(rule.showWhen, fields);
    }
  }

  return { entityId: entity.id, layoutId: layout.id, formVersionId, sections, fields };
}

export async function persistFormDesign(
  design: FormDesignState,
  serviceKey: string,
  serviceName: string,
): Promise<FormDesignState> {
  let next = { ...design };
  if (!next.entityId) {
    const loaded = await loadFormDesign(serviceKey, serviceName);
    next = { ...next, entityId: loaded.entityId, layoutId: loaded.layoutId, formVersionId: loaded.formVersionId };
  }
  if (!next.entityId) throw new Error("Could not create form entity.");

  const existingRes = await fetch(`/api/proxy/v1/metadata/entities/${next.entityId}/fields`);
  const existingPayload = (await parseJson(existingRes)) as { data?: MetadataFieldRow[] };
  const existingByApi = new Map((existingPayload.data ?? []).map((f) => [f.apiName, f]));

  let sortOrder = 0;
  for (const section of next.sections) {
    for (const fieldId of section.fieldIds) {
      const field = next.fields[fieldId];
      if (!field) continue;
      sortOrder += 1;
      const mapped = mapFieldTypeToMetadata(field.type);
      const body = {
        apiName: field.apiName,
        label: field.label,
        fieldType: mapped.fieldType,
        isRequired: field.required,
        picklistValues: field.choices ?? mapped.picklistValues,
        sortOrder,
      };

      const known = existingByApi.get(field.apiName);
      if (known?.id) {
        await parseJson(await fetch(`/api/proxy/v1/metadata/fields/${known.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: field.label,
            isRequired: field.required,
            picklistValues: field.choices,
            sortOrder,
          }),
        }));
        next.fields[fieldId] = { ...field, metadataFieldId: known.id };
      } else {
        const created = (await parseJson(await fetch(`/api/proxy/v1/metadata/entities/${next.entityId}/fields`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }))) as { data?: { id: string } };
        if (created.data?.id) {
          next.fields[fieldId] = { ...field, metadataFieldId: created.data.id };
        }
      }
    }
  }

  const sectionsPayload = next.sections.map((s) => ({
    label: s.label,
    columns: 1,
    fields: s.fieldIds.map((id) => next.fields[id]?.apiName).filter(Boolean) as string[],
  }));

  if (next.layoutId) {
    await parseJson(await fetch(`/api/proxy/v1/metadata/layouts/${next.layoutId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections: sectionsPayload }),
    }));
  } else {
    const layoutRes = (await parseJson(await fetch(`/api/proxy/v1/metadata/entities/${next.entityId}/layouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layoutType: "edit", sections: sectionsPayload, isDefault: true }),
    }))) as { data?: { id: string } };
    next.layoutId = layoutRes.data?.id;
  }

  const visibilityRules = Object.values(next.fields)
    .map((f) => {
      const showWhen = visibilityToShowWhen(f, next.fields);
      return showWhen ? { field: f.apiName, showWhen } : null;
    })
    .filter(Boolean) as { field: string; showWhen: string }[];

  if (next.layoutId) {
    if (next.formVersionId) {
      await parseJson(await fetch(`/api/proxy/v1/metadata/form-versions/${next.formVersionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibilityRules }),
      }));
    } else {
      const vRes = (await parseJson(await fetch(`/api/proxy/v1/metadata/forms/${next.layoutId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibilityRules, cascadeRules: [] }),
      }))) as { data?: { id: string } };
      next.formVersionId = vRes.data?.id;
    }
  }

  return next;
}

export function createField(type: DesignerFieldType, sectionId: string): FormFieldDefinition {
  return createFieldDefinition(type, sectionId);
}

export { entityApiName };
