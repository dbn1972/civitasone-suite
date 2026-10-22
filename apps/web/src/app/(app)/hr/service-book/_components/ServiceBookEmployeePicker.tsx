"use client";

/**
 * ServiceBookEmployeePicker -- GAP-HR-SERVICE-BOOK-04.
 *
 * Replaces the old free-text "Search employee" box (which only filtered whatever
 * rows had already loaded, by a typed fragment of the name) with the shared
 * EntityPicker over the employee directory: HR searches the WHOLE tenant by name
 * or employee number, and picking someone navigates to ?empId=<id>, so the page
 * is re-scoped server-side (title, stats, entries, print link) and the selection
 * lives in the URL -- shareable, and it survives a refresh.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EntityPicker } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

interface Props {
  /** The currently scoped employee id (?empId=), if any. */
  selectedId?: string;
  /** Their display name when the page already knows it, so the picker needs no lookup. */
  selectedLabel?: string;
}

export function ServiceBookEmployeePicker({ selectedId, selectedLabel }: Props) {
  const t = useTranslations("serviceBook");
  const router = useRouter();

  return (
    <EntityPicker
      value={selectedId ?? null}
      onChange={(value) => {
        const id = Array.isArray(value) ? value[0] : value;
        router.push(id ? `/hr/service-book?empId=${encodeURIComponent(id)}` : "/hr/service-book");
      }}
      search={searchEmployees}
      resolve={resolveEmployees}
      initialOptions={selectedId && selectedLabel ? [{ id: selectedId, label: selectedLabel }] : undefined}
      placeholder={t("employeePickerPlaceholder")}
      searchingText={t("employeePickerSearching")}
      noResultsText={t("employeePickerNoResults")}
      searchErrorText={t("employeePickerError")}
      aria-label={t("employeePickerLabel")}
    />
  );
}
