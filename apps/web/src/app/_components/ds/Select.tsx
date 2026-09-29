"use client";

import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { useFieldContext } from "./Field";
import { formControlStyle } from "./_formControlStyle";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Styled `<select>` sibling to `Input` (SF-14) -- same `Field` wiring
 * (id, aria-invalid, aria-describedby, aria-required/required, disabled).
 * Renders its `<option>` children exactly like the hand-rolled `<select>`
 * markup it replaces (see hr/locations/new/AddLocationForm.tsx); this
 * component only supplies the box styling and the accessibility wiring, not
 * an options abstraction.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    id,
    style,
    className,
    disabled,
    required,
    children,
    "aria-invalid": ariaInvalid,
    "aria-describedby": describedBy,
    "aria-required": ariaRequired,
    ...rest
  },
  ref,
) {
  const ctx = useFieldContext();
  const isRequired = required ?? ctx?.required ?? false;

  return (
    <select
      {...rest}
      ref={ref}
      id={id ?? ctx?.controlId}
      disabled={disabled ?? ctx?.disabled}
      required={isRequired || undefined}
      aria-invalid={ariaInvalid ?? (ctx?.invalid || undefined)}
      aria-describedby={describedBy ?? ctx?.describedById}
      aria-required={ariaRequired ?? (isRequired || undefined)}
      style={{ ...formControlStyle, ...style }}
      className={className}
    >
      {children}
    </select>
  );
});
