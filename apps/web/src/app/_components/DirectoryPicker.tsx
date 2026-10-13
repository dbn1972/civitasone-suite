"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { EntityPicker, type EntityOption } from "./ds";
import { searchDirectoryUsers, resolveDirectoryUsers, DIRECTORY_MIN_QUERY } from "@/lib/directory/searchUsers";
import { searchDepartments, resolveDepartments } from "@/lib/entityAdapters/department";
import { searchLocations, resolveLocations } from "@/lib/entityAdapters/location";
import { searchWarehouses, resolveWarehouses } from "@/lib/entityAdapters/warehouse";

export type DirectorySource = "user" | "department" | "location" | "warehouse";

const SOURCES: Record<
  DirectorySource,
  {
    search: (q: string, signal: AbortSignal, opts: { strict: boolean }) => Promise<EntityOption[]>;
    resolve: (ids: string[]) => Promise<EntityOption[]>;
  }
> = {
  // Tenant-wide non-PII directory (/identity/users/directory, open to any
  // member of the tenant). NOT identityUser.ts: its /identity/users list is
  // ADMIN-gated (and the /v1 path is not routed), so a picker built on it
  // could never load for a normal user.
  user: { search: searchDirectoryUsers, resolve: resolveDirectoryUsers },
  department: { search: searchDepartments, resolve: resolveDepartments },
  location: { search: searchLocations, resolve: resolveLocations },
  warehouse: { search: searchWarehouses, resolve: resolveWarehouses },
};

export interface DirectoryPickerProps {
  source: DirectorySource;
  /** Selected id, or null when nothing is chosen. */
  value: string | null;
  onChange: (id: string | null) => void;
  initialOption?: EntityOption;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  /** Overrides the per-source placeholder. */
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * SF-06: one picker for the non-employee directories that used to be a raw
 * "paste a UUID" box (user accounts, departments, locations, warehouses).
 * Wraps EntityPicker with the shared adapters in STRICT mode, so a failed
 * lookup shows a "could not load" alert rather than "No matches". The id is
 * never typed or read by a person. Employees have their own EmployeePicker.
 */
export function DirectoryPicker({
  source,
  value,
  onChange,
  initialOption,
  disabled,
  id,
  "aria-label": ariaLabel,
  placeholder,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  inputRef,
}: DirectoryPickerProps) {
  const t = useTranslations("directoryPicker");
  const adapter = SOURCES[source];
  const search = useMemo(
    () => (q: string, signal: AbortSignal) => adapter.search(q, signal, { strict: true }),
    [adapter],
  );
  return (
    <EntityPicker
      value={value}
      onChange={(v) => onChange((Array.isArray(v) ? v[0] : v) ?? null)}
      search={search}
      resolve={adapter.resolve}
      initialOptions={initialOption ? [initialOption] : undefined}
      placeholder={placeholder ?? t(`placeholder.${source}`)}
      searchingText={t("searching")}
      noResultsText={t(`noResults.${source}`)}
      searchErrorText={t("searchFailed")}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      inputRef={inputRef}
      minQueryLength={source === "user" ? DIRECTORY_MIN_QUERY : undefined}
    />
  );
}
