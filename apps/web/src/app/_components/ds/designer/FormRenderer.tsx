"use client";

import { useMemo, useState, useCallback } from "react";
import { FileUpload } from "../FileUpload";
import type { FormDesignState, FormFieldDefinition } from "./formTypes";
import { VALIDATION_PRESETS } from "./formTypes";

export interface FormRendererProps {
  design: FormDesignState;
  showRuntimeNote?: boolean;
  /** Runtime mode — stepped section navigation (FN-13). */
  mode?: "preview" | "stepped";
  values?: Record<string, string>;
  onChange?: (values: Record<string, string>) => void;
  /** Active section index for stepped mode. */
  activeSectionIndex?: number;
  onSectionChange?: (index: number) => void;
  /** Field-level errors keyed by apiName. */
  errors?: Record<string, string>;
  onFieldBlur?: (apiName: string) => void;
}

function fieldVisible(
  field: FormFieldDefinition,
  values: Record<string, string>,
  allFields: Record<string, FormFieldDefinition>,
): boolean {
  if (!field.visibility?.length) return true;
  return field.visibility.every((cond) => {
    const source = allFields[cond.sourceFieldId];
    const val = values[source?.apiName ?? ""] ?? "";
    switch (cond.operator) {
      case "empty":
        return val.trim() === "";
      case "not_empty":
        return val.trim() !== "";
      case "neq":
        return val !== (cond.value ?? "");
      default:
        return val === (cond.value ?? "");
    }
  });
}

function renderControl(
  field: FormFieldDefinition,
  value: string,
  onChange: (apiName: string, v: string) => void,
  inputId: string,
  onBlur?: () => void,
  error?: string,
) {
  const common = {
    id: inputId,
    className: "input" as const,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(field.apiName, e.target.value),
    onBlur,
    "aria-required": field.required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${inputId}-err` : undefined,
  };

  switch (field.type) {
    case "boolean":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(field.apiName, e.target.checked ? "true" : "false")}
            onBlur={onBlur}
          />
          Yes
        </label>
      );
    case "number":
      return <input {...common} type="number" min={field.numberMin} max={field.numberMax} />;
    case "date":
      return <input {...common} type="date" />;
    case "picklist_single":
    case "picklist_multi":
      return (
        <select
          {...common}
          multiple={field.type === "picklist_multi"}
          size={field.type === "picklist_multi" ? Math.min(4, field.choices?.length ?? 1) : undefined}
        >
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      );
    case "file":
      return (
        <FileUpload
          accept={(field.fileTypes ?? ["pdf", "jpg", "png"]).map((t) => `.${t}`).join(",")}
          maxSizeMb={field.fileMaxMb ?? 5}
          onUploaded={() => onChange(field.apiName, "uploaded")}
        />
      );
    case "address":
      return (
        <>
          <textarea {...common} rows={3} placeholder="Street, locality, city" />
          <span style={{ fontSize: 11, color: "var(--info-fg)", marginTop: 4, display: "inline-block" }}>
            bound to: location-service hierarchy
          </span>
        </>
      );
    case "ward":
      return (
        <>
          <select {...common}>
            <option value="">Select ward</option>
            <option value="ward-1">Ward 1 (sample)</option>
            <option value="ward-2">Ward 2 (sample)</option>
          </select>
          <span style={{ fontSize: 11, color: "var(--info-fg)", marginTop: 4, display: "inline-block" }}>
            bound to: ULB ward list
          </span>
        </>
      );
    case "profile_mobile":
      return <input {...common} type="tel" inputMode="tel" autoComplete="tel" />;
    case "profile_email":
      return <input {...common} type="email" autoComplete="email" />;
    default:
      return <input {...common} type="text" />;
  }
}

export function FormRenderer({
  design,
  showRuntimeNote = true,
  mode = "preview",
  values: controlledValues,
  onChange: onValuesChange,
  activeSectionIndex = 0,
  onSectionChange,
  errors = {},
  onFieldBlur,
}: FormRendererProps) {
  const [internalValues, setInternalValues] = useState<Record<string, string>>({});
  const values = controlledValues ?? internalValues;

  const setValues = useCallback(
    (next: Record<string, string>) => {
      if (onValuesChange) onValuesChange(next);
      else setInternalValues(next);
    },
    [onValuesChange],
  );

  const onChange = (apiName: string, v: string) => {
    setValues({ ...values, [apiName]: v });
  };

  const visibleSections = useMemo(
    () =>
      design.sections
        .map((section) => ({
          ...section,
          fields: section.fieldIds
            .map((id) => design.fields[id])
            .filter((f): f is FormFieldDefinition => !!f && fieldVisible(f, values, design.fields)),
        }))
        .filter((s) => s.fields.length > 0),
    [design, values],
  );

  const sectionsToRender = mode === "stepped"
    ? visibleSections.slice(activeSectionIndex, activeSectionIndex + 1)
    : visibleSections;

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 20 }} aria-label="Application form">
      {showRuntimeNote && mode === "preview" ? (
        <p
          style={{
            margin: 0,
            padding: "8px 10px",
            fontSize: 12,
            background: "var(--info-bg)",
            border: "1px solid var(--info-border)",
            borderRadius: "var(--r-sm)",
            color: "var(--ink2)",
          }}
        >
          Citizen preview — this is the same FormRenderer used on Apply. Type here to feel validation.
        </p>
      ) : null}

      {mode === "stepped" && visibleSections.length > 1 ? (
        <nav aria-label="Form sections" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {visibleSections.map((sec, idx) => (
            <button
              key={sec.id}
              type="button"
              className="btn"
              style={{
                minHeight: 44,
                fontSize: 13,
                opacity: idx === activeSectionIndex ? 1 : 0.7,
                borderColor: idx === activeSectionIndex ? "var(--info-fg)" : undefined,
              }}
              aria-current={idx === activeSectionIndex ? "step" : undefined}
              onClick={() => onSectionChange?.(idx)}
            >
              {idx + 1}. {sec.label}
            </button>
          ))}
        </nav>
      ) : null}

      {sectionsToRender.map((section) => (
        <fieldset
          key={section.id}
          style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 16, margin: 0 }}
        >
          <legend style={{ fontWeight: 600, padding: "0 6px" }}>{section.label}</legend>
          <div style={{ display: "grid", gap: 16 }}>
            {section.fields.map((field) => {
              const inputId = `frm-${field.apiName}`;
              const err = errors[field.apiName];
              return (
                <label key={field.id} htmlFor={inputId} style={{ display: "grid", gap: 6 }}>
                  <span>
                    {field.label}
                    {field.required ? <span aria-hidden style={{ color: "var(--bad-fg)" }}> *</span> : null}
                  </span>
                  {field.helpText ? (
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{field.helpText}</span>
                  ) : null}
                  {renderControl(
                    field,
                    values[field.apiName] ?? "",
                    onChange,
                    inputId,
                    () => onFieldBlur?.(field.apiName),
                    err,
                  )}
                  {err ? (
                    <span id={`${inputId}-err`} role="alert" style={{ fontSize: 12, color: "var(--bad-fg)" }}>
                      {err}
                    </span>
                  ) : null}
                  {field.validation?.preset && mode === "preview" ? (
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>
                      Validates as {VALIDATION_PRESETS.find((p) => p.id === field.validation?.preset)?.label}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {visibleSections.length === 0 ? (
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>Add fields to see the application form.</p>
      ) : null}
    </form>
  );
}
