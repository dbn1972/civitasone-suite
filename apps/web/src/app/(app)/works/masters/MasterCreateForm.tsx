"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/_components/ds";

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

type FieldSpec = TextField | MoneyField | CheckboxField;

// ─── Field map ────────────────────────────────────────────────────────────────

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
    { type: "text",     key: "workTypeId", label: "Work Type ID", required: true, placeholder: "Paste Work Type UUID" },
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
    { type: "text",     key: "programId", label: "Program ID", required: true, placeholder: "Paste Program UUID" },
    { type: "checkbox", key: "active",    label: "Active" },
  ],
  "schemes": [
    { type: "text",     key: "name",    label: "Name",    required: true },
    { type: "text",     key: "sponsor", label: "Sponsor" },
    { type: "checkbox", key: "active",  label: "Active" },
  ],
  "scopes": [
    { type: "text",     key: "name",       label: "Name",        required: true },
    { type: "text",     key: "workTypeId", label: "Work Type ID", required: true, placeholder: "Paste Work Type UUID" },
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
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
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
    { type: "text",     key: "name",  label: "Name", required: true },
    { type: "text",     key: "code",  label: "Code" },
    { type: "checkbox", key: "active", label: "Active" },
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

const DEFAULT_FIELDS: FieldSpec[] = [
  { type: "text",     key: "name",  label: "Name", required: true },
  { type: "text",     key: "code",  label: "Code" },
  { type: "checkbox", key: "active", label: "Active" },
];

function getFields(masterType: string): FieldSpec[] {
  return FIELD_MAP[masterType] ?? DEFAULT_FIELDS;
}

function humanizeMaster(prefix: string): string {
  const map: Record<string, string> = {
    "authorities":             "Authorities",
    "work-types":              "Work Types",
    "work-sub-types":          "Work Sub-Types",
    "proposer-types":          "Proposer Types",
    "programs":                "Programs",
    "publication-levels":      "Publication Levels",
    "repair-types":            "Repair Types",
    "schemes":                 "Schemes",
    "scopes":                  "Scopes",
    "tender-types":            "Tender Types",
    "user-departments":        "User Departments",
    "contractor-classes":      "Contractor Classes",
    "issue-types":             "Issue Types",
    "issue-description-types": "Issue Description Types",
    "assets":                  "Assets",
    "work-description-types":  "Work Description Types",
    "sr-items":                "SR Items",
  };
  return map[prefix] ?? prefix;
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

// ─── Component ────────────────────────────────────────────────────────────────

export function MasterCreateForm({
  masterType,
  onCreated,
}: {
  masterType: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<Record<string, string | boolean>>({});
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");

  const fields    = getFields(masterType);
  const typeLabel = humanizeMaster(masterType);

  function handleClose() {
    setOpen(false);
    setForm({});
    setError("");
  }

  function setValue(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const body: Record<string, unknown> = {};

      for (const field of fields) {
        if (field.type === "checkbox") {
          // Default to true if user never touched the checkbox
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
          // text
          const val = String(form[field.key] ?? "").trim();
          if (val !== "") {
            body[field.key] = val;
          } else if (field.required) {
            throw new Error(`${field.label} is required`);
          }
        }
      }

      const res = await fetch(`/api/proxy/v1/works/masters/${masterType}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status !== 202) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? `Server returned ${res.status}`);
      }

      toast.success("Created. Changes will reflect shortly.");
      handleClose();
      onCreated?.();
      setTimeout(() => router.refresh(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // ── Collapsed: just the "+ Add" button ──────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        className="btn primary"
        onClick={() => setOpen(true)}
        style={{ minHeight: 38, marginBottom: 4 }}
      >
        + Add {typeLabel}
      </button>
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
        Add {typeLabel}
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
                    <span style={{ color: "#e53e3e", marginLeft: 2 }}>*</span>
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
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ minHeight: 38 }}
          >
            {busy ? "Saving…" : "Create"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={handleClose}
            disabled={busy}
            style={{ minHeight: 38 }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
