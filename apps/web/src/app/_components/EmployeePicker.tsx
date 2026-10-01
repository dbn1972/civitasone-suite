"use client";

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { EntityPicker, type EntityOption } from "./ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

export interface EmployeePickerProps {
  /** Selected employee id, or null when nothing is chosen. */
  value: string | null;
  /**
   * Called with the chosen employee id and its display option (name +
   * employee code, department as sublabel) -- the option lets a caller echo
   * WHO was picked (e.g. in a confirm dialog) without a second lookup.
   * Both are null when the selection is cleared.
   */
  onChange: (id: string | null, option: EntityOption | null) => void;
  /** Label the caller already has for `value` (skips a resolve round-trip). */
  initialOption?: EntityOption;
  placeholder?: string;
  disabled?: boolean;
  /** Explicit input id (falls back to an ancestor Field's id). */
  id?: string;
  "aria-label"?: string;
}

/**
 * Single-employee picker (GAP-PAYROLL-LOANS-01; also the EmployeePicker that
 * GAP-PAYROLL-OFF-CYCLE-02 names): EntityPicker wired to the shared
 * employee adapter -- server-side `GET /v1/hrms/employees?q=` search (tenant-
 * scoped by the API, 20 rows per query, so it works for tenants far beyond
 * the endpoint's default page size) instead of a free-text "Employee ID
 * (UUID)" box. The id never has to be typed or read by a person.
 */
export function EmployeePicker({
  value,
  onChange,
  initialOption,
  placeholder,
  disabled,
  id,
  "aria-label": ariaLabel,
}: EmployeePickerProps) {
  const t = useTranslations("employeePicker");
  const knownRef = useRef<Map<string, EntityOption>>(
    new Map(initialOption ? [[initialOption.id, initialOption]] : []),
  );

  const remember = useCallback((opts: EntityOption[]) => {
    for (const opt of opts) knownRef.current.set(opt.id, opt);
    return opts;
  }, []);

  const search = useCallback(
    async (query: string, signal: AbortSignal) => remember(await searchEmployees(query, signal)),
    [remember],
  );
  const resolve = useCallback(
    async (ids: string[]) => remember(await resolveEmployees(ids)),
    [remember],
  );

  return (
    <EntityPicker
      value={value}
      onChange={(v) => {
        const next = (Array.isArray(v) ? v[0] : v) ?? null;
        onChange(next, next ? knownRef.current.get(next) ?? null : null);
      }}
      search={search}
      resolve={resolve}
      initialOptions={initialOption ? [initialOption] : undefined}
      placeholder={placeholder ?? t("placeholder")}
      searchingText={t("searching")}
      noResultsText={t("noResults")}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
    />
  );
}
