/**
 * form-validation.ts
 * Two client-side field-validation approaches live here, deliberately not
 * left as two competing "the way to do it" systems:
 *
 * - `useZodFieldValidation` (SF-14, recommended for new/migrated forms):
 *   rules live in one `z.object({...})` schema per form -- a single source
 *   of truth that also documents the shape being validated. Pairs with the
 *   `Field` / `Input` (and `Select` / `Textarea`) primitives in
 *   `app/_components/ds` -- see `Field.tsx`'s doc comment for a worked
 *   example, and hr/designations/new/AddDesignationForm.tsx for a real one.
 * - `useFieldValidation` + the `required()` / `minLength()` / ... `Validator`
 *   functions below (pre-SF-14, dependency-free): kept only for its existing
 *   callers -- hr/leave/apply/ApplyLeaveForm.tsx and
 *   hr/payroll/corrections/CreateCorrectionForm.tsx. Don't add new callers;
 *   migrate a form off this and onto `useZodFieldValidation` the next time
 *   it needs real changes, the way AddDesignationForm was.
 *
 * Both hooks return the same `{ fields, validate, reset, values }` shape, so
 * moving a form from one to the other only changes how its rules are
 * declared, never how it wires up its markup.
 */
import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Validator type
// ---------------------------------------------------------------------------

/** A pure function that returns an error string or undefined when valid. */
export type Validator = (value: string) => string | undefined;

// ---------------------------------------------------------------------------
// Common validators
// ---------------------------------------------------------------------------

/** Field must be non-empty (after trimming). */
export function required(): Validator {
  return (v) => (v.trim().length === 0 ? "This field is required." : undefined);
}

/** Value must be at least `n` characters (applied only to non-empty values). */
export function minLength(n: number): Validator {
  return (v) =>
    v.trim().length > 0 && v.trim().length < n
      ? `Must be at least ${n} characters.`
      : undefined;
}

/** Value must not exceed `n` characters. */
export function maxLength(n: number): Validator {
  return (v) =>
    v.length > n ? `Must be at most ${n} characters.` : undefined;
}

/**
 * Value must match `regex` when non-empty.
 * @param regex  Regular expression to test against.
 * @param msg    Error message shown when the pattern does not match.
 */
export function pattern(regex: RegExp, msg: string): Validator {
  return (v) =>
    v.trim().length > 0 && !regex.test(v) ? msg : undefined;
}

/** Value must be a valid e-mail address (RFC 5322 subset). */
export function email(): Validator {
  return pattern(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    "Enter a valid email address.",
  );
}

/**
 * Value must be a valid Indian 10-digit mobile number.
 * Accepts optional +91 or leading 0 prefix; strips spaces, dashes, and parens.
 * Digits must start with 6–9 (valid Indian mobile range).
 */
export function phone(): Validator {
  return (v) => {
    if (v.trim().length === 0) return undefined; // let required() handle empty
    const digits = v.replace(/[\s\-()]/g, "");
    const normalized = digits.startsWith("+91")
      ? digits.slice(3)
      : digits.startsWith("0")
        ? digits.slice(1)
        : digits;
    return /^[6-9]\d{9}$/.test(normalized)
      ? undefined
      : "Enter a valid 10-digit Indian mobile number.";
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function runValidators(validators: Validator[], value: string): string | undefined {
  for (const v of validators) {
    const err = v(value);
    if (err !== undefined) return err;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/** Per-field state returned by useFieldValidation. */
export interface FieldState {
  value: string;
  onChange: (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  onBlur: () => void;
  /** Validation error, only set once the field has been touched (blurred). */
  error: string | undefined;
  /** True after the field has been blurred at least once (or validate() was called). */
  touched: boolean;
}

export interface UseFieldValidationReturn<K extends string> {
  /** Per-field state objects — spread into input props or use individually. */
  fields: Record<K, FieldState>;
  /**
   * Touch all fields and run all validators.
   * Returns `true` if every field is valid; call this in your submit handler.
   */
  validate: () => boolean;
  /** Reset all fields to empty strings and clear touched state. */
  reset: () => void;
  /** Current raw values (useful for cross-field access). */
  values: Record<K, string>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useFieldValidation — validates on blur and on explicit validate() call.
 *
 * @param rules  Map of field name → array of Validator functions.
 *               Validators run left-to-right; the first failure stops the chain.
 *               Rules are re-read on every render, so validators can close over
 *               component state (useful for cross-field validation).
 *
 * @example
 * ```tsx
 * const { fields, validate } = useFieldValidation({
 *   name: [required()],
 *   email: [required(), email()],
 *   phone: [phone()],
 *   bio: [required(), minLength(20), maxLength(500)],
 * });
 *
 * return (
 *   <form onSubmit={(e) => { e.preventDefault(); if (validate()) submit(); }}>
 *     <input {...fields.name} aria-invalid={!!fields.name.error} />
 *     {fields.name.error && <span>{fields.name.error}</span>}
 *   </form>
 * );
 * ```
 */
export function useFieldValidation<K extends string>(
  rules: Record<K, Validator[]>,
): UseFieldValidationReturn<K> {
  // Freeze the key list on first render — the field set must not change.
  const keys = useRef(Object.keys(rules) as K[]).current;

  // Keep a stable ref to the latest rules so callbacks can read them without
  // going stale, even when validators close over component state.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const emptyRecord = <V>(fill: V): Record<K, V> =>
    Object.fromEntries(keys.map((k) => [k, fill])) as Record<K, V>;

  const [values, setValues] = useState<Record<K, string>>(() => emptyRecord(""));
  const [touched, setTouched] = useState<Record<K, boolean>>(() => emptyRecord(false));

  // Stable ref for values — used by validate() to read current state synchronously.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Build the per-field state objects during render (not memoised — cheap).
  const fields = Object.fromEntries(
    keys.map((key): [K, FieldState] => [
      key,
      {
        value: values[key],
        onChange(e) {
          const next = e.target.value;
          setValues((prev) => ({ ...prev, [key]: next }));
        },
        onBlur() {
          setTouched((prev) => ({ ...prev, [key]: true }));
        },
        error: touched[key]
          ? runValidators(rulesRef.current[key], values[key])
          : undefined,
        touched: touched[key],
      },
    ]),
  ) as Record<K, FieldState>;

  /** Touch all fields and return whether every field is currently valid. */
  const validate = useCallback((): boolean => {
    setTouched(emptyRecord(true));
    return keys.every(
      (k) => !runValidators(rulesRef.current[k], valuesRef.current[k]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  /** Reset all field values and clear touched state. */
  const reset = useCallback((): void => {
    setValues(emptyRecord(""));
    setTouched(emptyRecord(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return { fields, validate, reset, values };
}

// ---------------------------------------------------------------------------
// Zod-based hook (SF-14)
// ---------------------------------------------------------------------------

/** Per-field state returned by useZodFieldValidation -- same shape as FieldState above. */
export interface ZodFieldState {
  value: string;
  onChange: (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  onBlur: () => void;
  /** Validation error, only set once the field has been touched (blurred). */
  error: string | undefined;
  /** True after the field has been blurred at least once (or validate() was called). */
  touched: boolean;
}

export interface UseZodFieldValidationReturn<K extends string> {
  /** Per-field state objects — pass to Input/Select/Textarea (`value`, `onChange`, `onBlur`). */
  fields: Record<K, ZodFieldState>;
  /**
   * Touch all fields and run the schema against the current values.
   * Returns `true` when the whole schema parses; call this in your submit handler.
   */
  validate: () => boolean;
  /** Reset all fields to empty strings and clear touched state. */
  reset: () => void;
  /** Current raw (untrimmed, as-typed) values -- the schema's own `.trim()`/transforms apply only during validation, not here, matching useFieldValidation's `values` contract above. */
  values: Record<K, string>;
}

/**
 * useZodFieldValidation — the zod-schema-driven counterpart to
 * useFieldValidation above, with identical ergonomics (`fields` / `validate`
 * / `reset` / `values`) so adopting it only changes how a form declares its
 * rules -- a `z.object({...})` schema instead of an array of Validator
 * functions per field -- not how it wires up Field/Input.
 *
 * Every field is validated independently via `schema.shape[key]`, so one
 * field's error never depends on another's value; use a top-level
 * `.refine()` / `.superRefine()` on `schema` itself for cross-field rules
 * (checked by `validate()`, not per-field on blur).
 *
 * @param schema  A `z.object({...})` whose fields all parse `string` input
 *                (every value in this hook, like useFieldValidation's, is a
 *                plain string -- e.g. a numeric field stays a string and
 *                validates its digits with `.refine()`, the same convention
 *                the pre-existing hand-rolled `AddDesignationForm` used for
 *                its "level" field before this migration).
 *
 * @example
 * ```tsx
 * const schema = z.object({
 *   code: z.string().trim().min(1, "Code is required.").max(20, "Must be at most 20 characters."),
 *   name: z.string().trim().min(2, "Must be at least 2 characters.").max(200, "Must be at most 200 characters."),
 * });
 * const { fields, validate } = useZodFieldValidation(schema);
 *
 * return (
 *   <form onSubmit={(e) => { e.preventDefault(); if (validate()) submit(); }}>
 *     <Field label="Code" required error={fields.code.error}>
 *       <Input value={fields.code.value} onChange={fields.code.onChange} onBlur={fields.code.onBlur} />
 *     </Field>
 *   </form>
 * );
 * ```
 */
export function useZodFieldValidation<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): UseZodFieldValidationReturn<Extract<keyof Shape, string>> {
  type K = Extract<keyof Shape, string>;

  // Freeze the key list on first render — the field set must not change.
  const keys = useRef(Object.keys(schema.shape) as K[]).current;

  // Keep a stable ref to the latest schema so callbacks can read it without
  // going stale.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const emptyRecord = <V>(fill: V): Record<K, V> =>
    Object.fromEntries(keys.map((k) => [k, fill])) as Record<K, V>;

  const [values, setValues] = useState<Record<K, string>>(() => emptyRecord(""));
  const [touched, setTouched] = useState<Record<K, boolean>>(() => emptyRecord(false));

  // Stable ref for values — used by validate() to read current state synchronously.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  function fieldError(key: K, value: string): string | undefined {
    const result = schemaRef.current.shape[key].safeParse(value);
    return result.success ? undefined : result.error.issues[0]?.message;
  }

  // Build the per-field state objects during render (not memoised — cheap).
  const fields = Object.fromEntries(
    keys.map((key): [K, ZodFieldState] => [
      key,
      {
        value: values[key],
        onChange(e) {
          const next = e.target.value;
          setValues((prev) => ({ ...prev, [key]: next }));
        },
        onBlur() {
          setTouched((prev) => ({ ...prev, [key]: true }));
        },
        error: touched[key] ? fieldError(key, values[key]) : undefined,
        touched: touched[key],
      },
    ]),
  ) as Record<K, ZodFieldState>;

  /** Touch all fields and return whether the whole schema currently parses. */
  const validate = useCallback((): boolean => {
    setTouched(emptyRecord(true));
    return schemaRef.current.safeParse(valuesRef.current).success;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  /** Reset all field values and clear touched state. */
  const reset = useCallback((): void => {
    setValues(emptyRecord(""));
    setTouched(emptyRecord(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return { fields, validate, reset, values };
}
