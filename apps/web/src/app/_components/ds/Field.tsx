"use client";

import { createContext, useContext, useId } from "react";
import type { ReactNode } from "react";
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
  /** Disables the wrapped control (and dims the label). A control can still override this itself. */
  disabled?: boolean;
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
  children,
  className,
  style,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const errorId = `${controlId}-error`;
  const invalid = !!error;

  const ctx: FieldContextValue = {
    controlId,
    describedById: invalid ? errorId : undefined,
    invalid,
    required,
    disabled,
  };

  return (
    <div style={{ display: "grid", gap: 6, ...style }} className={className}>
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
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {invalid && (
        <span id={errorId} style={formErrorStyle}>
          {error}
        </span>
      )}
    </div>
  );
}
