"use client";

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { useFieldContext } from "./Field";
import { formControlStyle } from "./_formControlStyle";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Styled `<textarea>` sibling to `Input` (SF-14) -- same `Field` wiring
 * (id, aria-invalid, aria-describedby, aria-required/required, disabled).
 * Matches the `{ ...inputStyle, resize: "none", minHeight: N }` convention
 * hand-rolled textareas already use (see e.g.
 * hr/recruitment/new/NewJobOpeningForm.tsx); pass `rows` (as those forms do)
 * to size a specific instance, or a `style.minHeight` to override the
 * default floor.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
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
    <textarea
      {...rest}
      ref={ref}
      id={id ?? ctx?.controlId}
      disabled={disabled ?? ctx?.disabled}
      required={isRequired || undefined}
      aria-invalid={ariaInvalid ?? (ctx?.invalid || undefined)}
      aria-describedby={describedBy ?? ctx?.describedById}
      aria-required={ariaRequired ?? (isRequired || undefined)}
      style={{ ...formControlStyle, resize: "none", minHeight: 88, ...style }}
      className={className}
    />
  );
});
