"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Button, EntityPicker, type EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { humanizeMaster, PARENT_FIELD } from "./masterTypes";
import type { MasterItem, ParentOption } from "./MastersTable";

// ─── Field spec types ─────────────────────────────────────────────────────────

type TextField = {
  type: "text";
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
};

type MoneyField = {
  type: "money";
  key: string;
  label: string;
  required?: boolean;
};

type CheckboxField = {
  type: "checkbox";
  key: string;
  label: string;
};

// GAP-WORKS-MASTERS-03: a parent reference is a picker over fetched options,
// not a raw UUID the clerk pastes.
type SelectField = {
  type: "select";
  key: string;
  label: string;
  required?: boolean;
};

type FieldSpec = TextField | MoneyField | CheckboxField | SelectField;

// ─── Field map ────────────────────────────────────────────────────────────────

// COMP-004 detector note: static reference -- this defines which form
// FIELDS (type/key/label/required) each master-data type's create-form
// renders. It's a frontend form-schema decision, not fabricated records.
const FIELD_MAP: Record<string, FieldSpec[]> = {
  "authorities": [
    { type: "text",     key: "name",  label: "Name",  required: true },
    { type: "text",     key: "code",  label: "Code",  required: true },
    { type: "text",     key: "level", label: "Level", placeholder: "e.g. DO, DAO, SDO" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "work-types": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code", required: true },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "work-sub-types": [
    { type: "text",     key: "name",       label: "Name",        required: true },
    { type: "text",     key: "code",       label: "Code",        required: true },
    { type: "select",   key: "workTypeId", label: "Work Type",   required: true },
    { type: "checkbox", key: "active",     label: "Active" },
  ],
  "proposer-types": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "programs": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "publication-levels": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "repair-types": [
    { type: "text",     key: "name",      label: "Name",       required: true },
    { type: "select",   key: "programId", label: "Program",    required: true },
    { type: "checkbox", key: "active",    label: "Active" },
  ],
  "schemes": [
    { type: "text",     key: "name",    label: "Name",    required: true },
    { type: "text",     key: "sponsor", label: "Sponsor" },
    { type: "checkbox", key: "active",  label: "Active" },
  ],
  "scopes": [
    { type: "text",     key: "name",       label: "Name",        required: true },
    { type: "select",   key: "workTypeId", label: "Work Type",   required: true },
    { type: "text",     key: "unit",       label: "Unit",         required: true, placeholder: "e.g. m, sqm, nos" },
    { type: "checkbox", key: "active",     label: "Active" },
  ],
  "tender-types": [
    { type: "text",     key: "name",     label: "Name",      required: true },
    { type: "text",     key: "rateType", label: "Rate Type", placeholder: "e.g. item_rate, percentage" },
    { type: "checkbox", key: "active",   label: "Active" },
  ],
  "user-departments": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "contractor-classes": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "issue-types": [
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
  ],
  "issue-description-types": [
    { type: "text",     key: "name",        label: "Name",       required: true },
    { type: "select",   key: "issueTypeId", label: "Issue Type", required: true },
    { type: "checkbox", key: "active",       label: "Active" },
  ],
  "assets": [
    { type: "text",     key: "code",     label: "Code",       required: true },
    { type: "text",     key: "name",     label: "Name",       required: true },
    { type: "text",     key: "type",     label: "Asset Type" },
    { type: "text",     key: "district", label: "District" },
    { type: "text",     key: "taluka",   label: "Taluka" },
    { type: "text",     key: "chainage", label: "Chainage" },
    { type: "money",    key: "cost",     label: "Cost (₹)" },
    { type: "checkbox", key: "active",   label: "Active" },
  ],
  "work-description-types": [
    { type: "text",     key: "keyword",    label: "Keyword",    required: true },
    { type: "select",   key: "workTypeId", label: "Work Type",  required: true },
    { type: "checkbox", key: "active",       label: "Active" },
  ],
  "sr-items": [
    { type: "text",     key: "zone",        label: "Zone",        required: true },
    { type: "text",     key: "srYear",      label: "SR Year",     required: true, placeholder: "e.g. 2024-25" },
    { type: "text",     key: "itemCode",    label: "Item Code",   required: true },
    { type: "text",     key: "description", label: "Description", required: true },
    { type: "text",     key: "unit",        label: "Unit",        required: true },
    { type: "money",    key: "rate",        label: "Rate (₹)",    required: true },
    { type: "checkbox", key: "active",      label: "Active" },
  ],
};

// COMP-004 detector note: static reference -- same rationale as FIELD_MAP
// above: this is the fallback form-schema for a master type with no
// specific field list, not fabricated data.
const DEFAULT_FIELDS: FieldSpec[] = [
  { type: "text",     key: "name",  label: "Name", required: true },
  { type: "text",     key: "code",  label: "Code" },
  { type: "checkbox", key: "active", label: "Active" },
];

function getFields(masterType: string): FieldSpec[] {
  return FIELD_MAP[masterType] ?? DEFAULT_FIELDS;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  minHeight: 40,
  borderRadius: 6,
  border: "1px solid var(--line)",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

// On create, the write is a 202 CQRS command: the read model may lag. Poll
// router.refresh() a few times until the row shows up (GAP-WORKS-MASTERS-05)
// instead of a single fixed 600ms refresh that leaves a slow write invisible.
const REFRESH_DELAYS_MS = [600, 1500, 3000];

// ─── Component ────────────────────────────────────────────────────────────────

export function MasterCreateForm({
  masterType,
  onCreated,
  parentOptions = [],
  editItem,
  onDone,
  canWrite = true,
}: {
  masterType: string;
  onCreated?: () => void;
  /** Options for the parent picker (GAP-WORKS-MASTERS-03). */
  parentOptions?: ParentOption[];
  /** When set, the form edits this row (GAP-WORKS-MASTERS-04) rather than creating. */
  editItem?: MasterItem;
  /** Called when an edit is saved or cancelled. */
  onDone?: () => void;
  /**
   * GAP-WORKS-HOME-05: when false, a read-only role sees no create control at
   * all (renders nothing). Defaults true so existing callers are unchanged.
   * The server remains the authority (POST/PATCH 403 non-admins).
   */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const isEdit = Boolean(editItem);
  const parent = PARENT_FIELD[masterType as keyof typeof PARENT_FIELD];

  const [open, setOpen] = useState(isEdit);
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    editItem ? seedForm(getFields(masterType), editItem) : {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formError = useFormError("master data");

  const allFields = getFields(masterType);
  // In edit mode only name/code/active are editable server-side
  // (patchMasterSchema) — parent links and money fields are immutable to
  // avoid rewriting history on referenced masters.
  const fields = isEdit
    ? allFields.filter((f) => ["name", "code", "active"].includes(f.key))
    : allFields;
  const typeLabel = humanizeMaster(masterType);

  const parentOpts: EntityOption[] = parentOptions.map((o) => ({ id: o.id, label: o.label }));

  function searchParents(query: string): Promise<EntityOption[]> {
    const q = query.trim().toLowerCase();
    const matches = q === "" ? parentOpts : parentOpts.filter((o) => o.label.toLowerCase().includes(q));
    return Promise.resolve(matches.slice(0, 50));
  }
  function resolveParents(ids: string[]): Promise<EntityOption[]> {
    return Promise.resolve(parentOpts.filter((o) => ids.includes(o.id)));
  }

  function handleClose() {
    setOpen(false);
    setForm({});
    setError("");
    onDone?.();
  }

  function setValue(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function pollRefresh(index = 0) {
    if (index >= REFRESH_DELAYS_MS.length) return;
    setTimeout(() => {
      router.refresh();
      pollRefresh(index + 1);
    }, REFRESH_DELAYS_MS[index]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    formError.clear();

    try {
      const body: Record<string, unknown> = {};

      for (const field of fields) {
        if (field.type === "checkbox") {
          body[field.key] = form[field.key] !== undefined ? form[field.key] : true;
        } else if (field.type === "money") {
          const val = String(form[field.key] ?? "").trim();
          if (val !== "") {
            const numeric = parseFloat(val);
            if (Number.isNaN(numeric)) throw new Error(`${field.label} must be a number`);
            body[field.key] = String(Math.round(numeric * 100));
          } else if (field.required) {
            throw new Error(`${field.label} is required`);
          }
        } else {
          // text | select
          const val = String(form[field.key] ?? "").trim();
          if (val !== "") {
            body[field.key] = val;
          } else if (field.required) {
            throw new Error(`${field.label} is required`);
          }
        }
      }

      let res: Response;
      if (isEdit && editItem) {
        body.version = Number(editItem.version ?? 1);
        res = await fetch(`/api/proxy/v1/works/masters/${masterType}/${editItem.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/proxy/v1/works/masters/${masterType}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.status !== 202) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }

      toast.success(isEdit ? "Saved. Changes will reflect shortly." : "Created. Changes will reflect shortly.");
      handleClose();
      onCreated?.();
      pollRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // ── Collapsed (create only): just the "+ Add" button ─────────────────────────
  if (!open) {
    // GAP-WORKS-HOME-05: a read-only role gets no create control at all.
    if (!canWrite) return null;
    return (
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        style={{ minHeight: 38, marginBottom: 4 }}
      >
        + Add {typeLabel}
      </Button>
    );
  }

  // ── Expanded: inline form ────────────────────────────────────────────────────
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 20,
        marginBottom: 4,
        background: "var(--surface, var(--bg, #fff))",
      }}
    >
      <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>
        {isEdit ? `Edit ${typeLabel}` : `Add ${typeLabel}`}
      </h3>

      {error && (
        <div
          style={{
            background: "#fef2f2",
            color: "#b42318",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 13,
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
            alignItems: "end",
          }}
        >
          {fields.map((field) => {
            if (field.type === "checkbox") {
              return (
                <div
                  key={field.key}
                  style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}
                >
                  <input
                    id={`mcf-${masterType}-${field.key}`}
                    type="checkbox"
                    checked={(form[field.key] as boolean | undefined) ?? true}
                    onChange={(e) => setValue(field.key, e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  <label
                    htmlFor={`mcf-${masterType}-${field.key}`}
                    style={{ fontSize: 13, cursor: "pointer", userSelect: "none" }}
                  >
                    {field.label}
                  </label>
                </div>
              );
            }

            if (field.type === "select") {
              const selected = String(form[field.key] ?? "");
              return (
                <div key={field.key}>
                  <label style={labelStyle} id={`mcf-${masterType}-${field.key}-label`}>
                    {field.label}
                    {field.required && (
                      <span style={{ color: "#e53e3e", marginInlineStart: 2 }}>*</span>
                    )}
                  </label>
                  <EntityPicker
                    aria-label={`${field.label}${parent ? ` (${humanizeMaster(parent.optionsType)})` : ""}`}
                    value={selected === "" ? null : selected}
                    onChange={(v) => setValue(field.key, Array.isArray(v) ? (v[0] ?? "") : (v ?? ""))}
                    search={searchParents}
                    resolve={resolveParents}
                    initialOptions={parentOpts}
                    placeholder={`Search ${field.label.toLowerCase()}…`}
                    minQueryLength={0}
                  />
                </div>
              );
            }

            // text | money
            const isMoney = field.type === "money";
            return (
              <div key={field.key}>
                <label
                  htmlFor={`mcf-${masterType}-${field.key}`}
                  style={labelStyle}
                >
                  {field.label}
                  {field.required && (
                    <span style={{ color: "#e53e3e", marginInlineStart: 2 }}>*</span>
                  )}
                </label>
                <input
                  id={`mcf-${masterType}-${field.key}`}
                  type={isMoney ? "number" : "text"}
                  step={isMoney ? "0.01" : undefined}
                  min={isMoney ? "0" : undefined}
                  value={String(form[field.key] ?? "")}
                  placeholder={field.type === "text" ? field.placeholder : undefined}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            style={{ minHeight: 38 }}
          >
            {busy ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={busy}
            style={{ minHeight: 38 }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function seedForm(fields: FieldSpec[], item: MasterItem): Record<string, string | boolean> {
  const seeded: Record<string, string | boolean> = {};
  for (const f of fields) {
    const raw = item[f.key];
    if (f.type === "checkbox") {
      seeded[f.key] = raw == null ? true : Boolean(raw);
    } else if (f.type === "money") {
      // stored as minor units (paise); show as rupees in the form
      seeded[f.key] = raw != null ? String(Number(raw) / 100) : "";
    } else {
      seeded[f.key] = raw != null ? String(raw) : "";
    }
  }
  return seeded;
}
