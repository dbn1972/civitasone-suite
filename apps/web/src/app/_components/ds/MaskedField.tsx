"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import type { InputProps } from "./Input";
import { formErrorStyle, formLabelStyle } from "./_formControlStyle";

export interface MaskedFieldProps {
  /** Explicit id for the editable control; auto-generated when omitted. */
  id?: string;
  label: string;
  /**
   * The value exactly as the API returned it, already masked (e.g. "******7890").
   * Blank/absent means nothing is on file, so there is nothing to protect and
   * the plain editable control shows straight away.
   */
  maskedValue?: string | null;
  /** What the user is typing. Starts EMPTY -- it is never seeded from `maskedValue`. */
  value: string;
  onChange: (next: string) => void;
  error?: string;
  /** Pre-translated read-only line, e.g. "Current: ******7890". */
  currentLabel: string;
  /** Pre-translated button texts. */
  changeLabel: string;
  keepLabel: string;
  inputProps?: Omit<InputProps, "value" | "onChange" | "id">;
  /** Extra controls shown only while the value is being changed (e.g. a confirm-entry input). */
  children?: ReactNode;
  /** Fires when the user starts changing the value (true) or backs out to "keep current" (false). */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * Edit control for a value the API only ever returns MASKED (bank account,
 * phone). A masked value must never be seeded into an editable input: editing
 * "******7890" down to something else persists a corrupted number, and an
 * untouched one risks overwriting the real value with asterisks. So it shows
 * the current value read-only and the input only appears (empty) once the user
 * explicitly chooses to change it; "Keep current" backs out and clears what was
 * typed. The parent therefore only ever has a value to submit when the user
 * deliberately typed one.
 */
export function MaskedField({
  id, label, maskedValue, value, onChange, error, currentLabel, changeLabel, keepLabel, inputProps, children, onEditingChange,
}: MaskedFieldProps) {
  const hasMasked = !!maskedValue && maskedValue.trim() !== "";
  const [editing, setEditing] = useState(!hasMasked);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const focusOnEdit = useRef(false);
  const focusOnKeep = useRef(false);

  useEffect(() => {
    if (editing && focusOnEdit.current) {
      focusOnEdit.current = false;
      inputRef.current?.focus();
    }
    // "Keep current" unmounts the input (and the button that was just pressed), which would
    // drop keyboard focus to <body>. Hand it back to the Change button that replaces them.
    if (!editing && focusOnKeep.current) {
      focusOnKeep.current = false;
      changeRef.current?.focus();
    }
  }, [editing]);

  function startChange() {
    focusOnEdit.current = true;
    setEditing(true);
    onEditingChange?.(true);
  }

  function keepCurrent() {
    focusOnKeep.current = true;
    onChange("");
    setEditing(false);
    onEditingChange?.(false);
  }

  if (!editing) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <span style={formLabelStyle}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--ink)" }}>{currentLabel}</span>
          <Button ref={changeRef} variant="ghost" size="sm" onClick={startChange} aria-label={`${changeLabel}: ${label}`}>
            {changeLabel}
          </Button>
        </div>
        {error && <span role="alert" style={formErrorStyle}>{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Field id={id} label={label} error={error}>
        <Input ref={inputRef} {...inputProps} value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      {hasMasked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{currentLabel}</span>
          <Button variant="ghost" size="sm" onClick={keepCurrent} aria-label={`${keepLabel}: ${label}`}>{keepLabel}</Button>
        </div>
      )}
      {children}
    </div>
  );
}
