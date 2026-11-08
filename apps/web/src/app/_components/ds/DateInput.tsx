"use client";

/**
 * DateInput -- Indian date entry for the form-field standard (UX-R5, GLB-10).
 *
 * Officers type DD-MM-YYYY (separators are inserted as they type; 04/11/2026, 4.11.2026 and a pasted ISO date are
 * accepted); `value` / `onChange` are always ISO YYYY-MM-DD, so callers and the API are unchanged from a native
 * date input. Inside a ds/Field the date is checked on blur ("31-02-2026 is not a real date ..."). `onChange`
 * receives "" while the text is incomplete or not a real date, so a form can never submit a half-typed date.
 */
import { forwardRef, useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { useFieldContext } from "./Field";
import { formControlStyle } from "./_formControlStyle";
import { isoToIndianText, maskIndianDateText, parseIndianDateText } from "@/lib/indianDate";

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  /** ISO YYYY-MM-DD, or "" for empty. */
  value: string;
  onChange: (iso: string) => void;
  /** ISO bounds, checked on blur. */
  min?: string;
  max?: string;
};

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, min, max, id, style, disabled, required, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, placeholder, ...rest },
  ref,
) {
  const ctx = useFieldContext();
  const [text, setText] = useState(() => isoToIndianText(value));

  // Follow a value set from outside (reset, prefill) without fighting the officer while they type.
  useEffect(() => {
    const current = parseIndianDateText(text);
    if ((value || "") !== (current ?? "")) setText(isoToIndianText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only when the outside value changes.
  }, [value]);

  const isRequired = required ?? ctx?.required ?? false;
  return (
    <input
      {...rest}
      ref={ref}
      id={id ?? ctx?.controlId}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      placeholder={placeholder ?? "DD-MM-YYYY"}
      value={text}
      data-date-input=""
      data-min={min}
      data-max={max}
      disabled={disabled ?? ctx?.disabled}
      required={isRequired || undefined}
      aria-required={isRequired || undefined}
      aria-invalid={ariaInvalid ?? (ctx?.invalid || undefined)}
      aria-describedby={[describedBy, ctx?.describedById].filter(Boolean).join(" ") || undefined}
      onChange={(e) => {
        const masked = maskIndianDateText(e.target.value);
        setText(masked);
        onChange(parseIndianDateText(masked) ?? "");
      }}
      style={{ ...formControlStyle, fontVariantNumeric: "tabular-nums", ...style }}
    />
  );
});
