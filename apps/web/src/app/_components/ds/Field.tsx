"use client";

import { createContext, useContext, useId, useState } from "react";
import type { FocusEvent, FormEvent, ReactNode } from "react";
import { dateTextError, maskIndianDateText } from "@/lib/indianDate";
import { formErrorStyle, formLabelStyle, formRequiredMarkStyle } from "./_formControlStyle";

export interface FieldContextValue {
  /** id of the control (Input/Select/Textarea) this Field wraps, for its `htmlFor`/`id` pairing. */
  controlId: string;
  /** id of the rendered error message, set only while there is one -- the control's `aria-describedby`. */
  describedById: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | undefined>(undefined);

/**
 * Read by Input/Select/Textarea to pick up id/aria wiring from an ancestor
 * Field. Returns `undefined` outside a Field, which is how those controls
 * fall back to working standalone (see their own doc comments).
 */
export function useFieldContext(): FieldContextValue | undefined {
  return useContext(FieldContext);
}

export interface FieldProps {
  /** Explicit id for the wrapped control; auto-generated with `useId()` when omitted. */
  id?: string;
  /** Field label content. */
  label: ReactNode;
  /**
   * Shows the required indicator next to the label and marks the wrapped
   * control `required`/`aria-required`. This only *signals* required -- it
   * doesn't itself enforce anything; pair it with real validation (e.g.
   * `useZodFieldValidation`, see form-validation.ts) that actually blocks
   * submission.
   */
  required?: boolean;
  /**
   * Inline error message -- e.g. `useFormError().fieldError(name)` for a
   * backend rejection, or a `useZodFieldValidation` field's `.error` for a
   * client-side one (or both, see AddDesignationForm.tsx for the pattern of
   * preferring the backend one when both could apply). Renders below the
   * control and wires `aria-invalid` / `aria-describedby` onto it.
   */
  error?: string;
  /**
   * @deprecated No effect. The inline error is always announced (`role="alert"`, WCAG 4.1.3, decided in
   * SF-14b #2024). Kept only so existing callers compile.
   */
  announce?: boolean;
  /** Disables the wrapped control (and dims the label). A control can still override this itself. */
  disabled?: boolean;
  /**
   * UX-R5 form-field standard: one line of help under the label ("As on the invoice", "DD-MM-YYYY"), wired to
   * the control via aria-describedby.
   */
  hint?: ReactNode;
  /**
   * UX-R5: inline validation on blur. Called with the control value when it loses focus; return the message to
   * show, or undefined. Without it, a `required` field that is left empty shows `requiredMessage` on blur, and a
   * ds/DateInput is checked as DD-MM-YYYY. An explicit `error` prop (server or submit-time) always wins.
   */
  validate?: (value: string) => string | undefined;
  /** Message for an empty required field on blur. Default: "<Label> is required." (label as plain text). */
  requiredMessage?: string;
  /** The form control -- normally a single Input, Select, or Textarea. */
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Shared form-field primitive (SF-14): label + control + inline error,
 * wired for accessibility (label `htmlFor`/`id` association, `aria-invalid`,
 * `aria-describedby`, `aria-required`) so every form that adopts it gets
 * this right by construction, instead of each author re-wiring all four by
 * hand -- which is what every hr/ form did before this (see e.g.
 * hr/departments/new/AddDepartmentForm.tsx, hr/designations/new/
 * AddDesignationForm.tsx pre-migration, hr/locations/new/AddLocationForm.tsx
 * for the markup this replaces).
 *
 * `Field` itself renders no input -- it provides a context that `Input`,
 * `Select`, and `Textarea` (see the co-located files in this directory)
 * consume to pick up their `id`/`aria-*`/`disabled` automatically. A control
 * used outside any `Field` still works: it just falls back to whatever
 * id/aria-* props are passed to it directly, exactly like the hand-rolled
 * markup it replaces.
 *
 * @example
 * ```tsx
 * <Field label="Code" required error={formError.fieldError("code")}>
 *   <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
 * </Field>
 * ```
 */
export function Field({
  id,
  label,
  required = false,
  error,
  disabled = false,
  hint,
  validate,
  requiredMessage,
  children,
  className,
  style,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const errorId = `${controlId}-error`;
  const hintId = `${controlId}-hint`;
  // UX-R5: the message found on blur (shown only after the officer has left the field once).
  const [blurError, setBlurError] = useState<string | undefined>(undefined);
  const shownError = error || blurError;
  const invalid = !!shownError;

  function check(target: EventTarget | null): string | undefined {
    const el = target as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) | null;
    if (!el || typeof el.value !== "string") return undefined;
    const value = el.value;
    if (validate) return validate(value);
    // Composite pickers (EntityPicker / combobox) can show empty text while a value is chosen: they validate via
    // `validate` or `error`, never the default empty check. Only the Field own control is checked by default.
    if (el.getAttribute("role") === "combobox" || el.id !== controlId) return undefined;
    const plainLabel = typeof label === "string" ? label : undefined;
    if (el instanceof HTMLElement && el.dataset.dateInput !== undefined) {
      // Capture handlers run before DateInput masks the keystroke: check the masked text the officer will see.
      return dateTextError(maskIndianDateText(value), { required, label: plainLabel, min: el.dataset.min, max: el.dataset.max });
    }
    if (required && !value.trim()) return requiredMessage ?? (plainLabel ? `${plainLabel} is required.` : "This field is required.");
    return undefined;
  }

  function onBlurCapture(e: FocusEvent<HTMLDivElement>) {
    // Moving focus between parts of one composite control (a picker list) is not leaving the field.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setBlurError(check(e.target));
  }

  function onInputCapture(e: FormEvent<HTMLDivElement>) {
    // Once a message is showing, clear it as soon as the value becomes acceptable (no new message mid-typing).
    if (blurError && !check(e.target)) setBlurError(undefined);
  }

  const describedById = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;
  const ctx: FieldContextValue = {
    controlId,
    describedById,
    invalid,
    required,
    disabled,
  };

  return (
    <div style={{ display: "grid", gap: 6, ...style }} className={className} onBlurCapture={onBlurCapture} onInputCapture={onInputCapture} onChangeCapture={onInputCapture}>
      <label htmlFor={controlId} style={{ ...formLabelStyle, opacity: disabled ? 0.6 : 1 }}>
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden="true" style={formRequiredMarkStyle}>
              *
            </span>
          </>
        )}
      </label>
      {hint ? (
        <span id={hintId} style={{ fontSize: 12, color: "var(--ink2, #475569)", marginTop: -2 }}>
          {hint}
        </span>
      ) : null}
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {invalid && (
        <span id={errorId} role="alert" style={formErrorStyle}>
          {shownError}
        </span>
      )}
    </div>
  );
}
