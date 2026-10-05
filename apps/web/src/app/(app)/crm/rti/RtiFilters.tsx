"use client";

/**
 * GAP-CRM-RTI-02: URL-driven filter controls for the RTI register. The loader
 * (getCrmRti) and the crm-service list endpoint already accept
 * status / section / search / page / limit; previously nothing in the UI set
 * them, so filters only worked if a URL was hand-typed and pages 51+ were
 * unreachable.
 *
 * Changing a filter navigates to a new URL (router.push) with `page` dropped,
 * so the server page re-fetches page 1 of the narrowed register and the Total
 * tile reflects the active filter. The pager itself is rendered server-side on
 * the page (plain links) so it works without client JS.
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

const STATUS_OPTIONS = [
  { value: "", labelKey: "statusAll" },
  { value: "RECEIVED", labelKey: "statusReceived" },
  { value: "TRANSFERRED", labelKey: "statusTransferred" },
  { value: "RESPONDED", labelKey: "statusResponded" },
  { value: "REJECTED", labelKey: "statusRejected" },
  { value: "FIRST_APPEAL", labelKey: "statusFirstAppeal" },
  { value: "SECOND_APPEAL", labelKey: "statusSecondAppeal" },
  { value: "DISPOSED", labelKey: "statusDisposed" },
] as const;

const SECTION_OPTIONS = [
  { value: "", labelKey: "sectionAll" },
  { value: "s.6", labelKey: "section6" },
  { value: "s.11", labelKey: "section11" },
] as const;

export function RtiFilters({
  status,
  section,
  search,
}: {
  status: string;
  section: string;
  search: string;
}) {
  const t = useTranslations("crmRtiFilters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(search);

  // Keep the search box in sync when the URL changes (e.g. back/forward).
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  /** Navigate with the given overrides applied; `page` is always dropped (back to page 1). */
  function navigate(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.delete("page");
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const selectStyle = {
    padding: "6px 10px",
    border: "1px solid var(--line)",
    borderRadius: "var(--r)",
    background: "var(--bg)",
    color: "var(--ink)",
    fontSize: 13,
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-end",
        flexWrap: "wrap",
        margin: "16px 0 8px",
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
        {t("status")}
        <select
          aria-label={t("filterByStatus")}
          value={status}
          onChange={(e) => navigate({ status: e.target.value })}
          style={selectStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
        {t("section")}
        <select
          aria-label={t("filterBySection")}
          value={section}
          onChange={(e) => navigate({ section: e.target.value })}
          style={selectStyle}
        >
          {SECTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>
      </label>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft.trim() || undefined });
        }}
        style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}
      >
        {t("search")}
        <span style={{ display: "flex", gap: 6 }}>
          <input
            aria-label={t("searchAriaLabel")}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("searchPlaceholder")}
            style={{ ...selectStyle, width: 240 }}
          />
          <button type="submit" className="btn">{t("search")}</button>
        </span>
      </form>
    </div>
  );
}
