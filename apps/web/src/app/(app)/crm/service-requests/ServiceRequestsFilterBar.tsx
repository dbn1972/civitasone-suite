"use client";

/**
 * GAP-CRM-SERVICE-REQUESTS-01: the register used to load only the first 50 rows
 * and then page/sort/search them in the browser, so "Page 1 of N", the search
 * box and the filters silently covered a fraction of the data and the ?status
 * etc. params were never set by any control. This bar is that control: it writes
 * status/priority/serviceType/search into the URL (resetting to page 1), which
 * re-runs the server page's loader with those params so filtering/searching
 * happens server-side over the whole register, not a client-held page.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

const SELECT: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 13,
};

const STATUSES = ["open", "in_progress", "pending", "resolved", "closed", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

export function ServiceRequestsFilterBar({
  status,
  priority,
  serviceType,
  search,
  serviceTypes,
}: {
  status?: string;
  priority?: string;
  serviceType?: string;
  search?: string;
  serviceTypes: string[];
}) {
  const t = useTranslations("crmServiceRequestsFilterBar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState(search ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value) params.set(key, value);
    else params.delete(key);
    // Any filter change returns to the first page of the new result set.
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("search", searchText.trim());
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "8px 0 4px" }}>
      <form onSubmit={submitSearch} role="search" style={{ display: "flex", gap: 6, flex: "1 1 240px" }}>
        <input
          type="search"
          aria-label={t("searchAria")}
          placeholder={t("searchPlaceholder")}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ ...SELECT, flex: 1 }}
        />
        <button type="submit" className="btn">{t("search")}</button>
      </form>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)" }}>
        {t("status")}
        <select aria-label={t("filterStatusAria")} value={status ?? ""} onChange={(e) => setParam("status", e.target.value)} style={SELECT}>
          <option value="">{t("all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statusOption.${s}`)}</option>)}
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)" }}>
        {t("priority")}
        <select aria-label={t("filterPriorityAria")} value={priority ?? ""} onChange={(e) => setParam("priority", e.target.value)} style={SELECT}>
          <option value="">{t("all")}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priorityOption.${p}`)}</option>)}
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)" }}>
        {t("serviceType")}
        <select aria-label={t("filterServiceTypeAria")} value={serviceType ?? ""} onChange={(e) => setParam("serviceType", e.target.value)} style={SELECT}>
          <option value="">{t("all")}</option>
          {serviceTypes.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </label>
    </div>
  );
}
