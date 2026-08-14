/**
 * form-validation.ts
 * Lightweight, dependency-free form validation hook and common validators.
 * TypeScript typed; works with any React client component.
 */
import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";

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
