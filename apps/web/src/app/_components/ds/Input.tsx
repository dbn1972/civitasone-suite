"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { useFieldContext } from "./Field";
import { formControlStyle } from "./_formControlStyle";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Styled `<input>` for the `Field` primitive (SF-14). Rendered inside a
 * `Field`, it automatically picks up that field's `id`, `aria-invalid`,
 * `aria-describedby`, `aria-required`/`required`, and `disabled` -- an
 * explicit prop of the same name on `Input` itself always wins, so a caller
 * can still override any one of them.
 *
 * Used standalone (no ancestor `Field`), it behaves like a plain styled
 * `<input>` and expects the caller to pass its own `id`/`aria-*` props,
 * exactly like the raw `<input style={inputStyle} />` markup it replaces.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id,
    style,
    className,
    disabled,
    required,
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
    <input
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
    />
  );
});
