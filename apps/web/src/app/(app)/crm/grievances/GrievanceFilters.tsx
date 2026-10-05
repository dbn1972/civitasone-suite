"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * GAP-CRM-GRIEVANCES-02: server-side filter controls for the grievance
 * register. The list API (crm-service modules/grievances/routes.ts) paginates
 * and filters server-side on status / priority / search, but the page used to
 * forward those params with no control to set them — server filtering was only
 * reachable by hand-editing the URL, and the table's own client-side search box
 * only narrowed the 50 rows already on the page.
 *
 * These selects/inputs write the URL query (via router.replace, so filtering
 * doesn't push a history entry per keystroke) and reset to page 1 on any
 * change. Status/priority are validated against the known CPGRAMS enums before
 * they ever reach the URL, so a stale bookmark can't push a bogus value at the
 * API.
 */

// CPGRAMS status vocabulary — mirrors crm-service grievances-domain.ts STATUS.
const STATUS_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "REGISTERED", labelKey: "statusRegistered" },
  { value: "FORWARDED", labelKey: "statusForwarded" },
  { value: "ATTENDED", labelKey: "statusAttended" },
  { value: "DISPOSED", labelKey: "statusDisposed" },
  { value: "APPEAL", labelKey: "statusAppeal" },
];
const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value));

// Mirrors crm-service grievances-domain.ts PRIORITY.
const PRIORITY_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "urgent", labelKey: "priorityUrgent" },
  { value: "high", labelKey: "priorityHigh" },
  { value: "normal", labelKey: "priorityNormal" },
  { value: "low", labelKey: "priorityLow" },
];
const PRIORITY_VALUES = new Set(PRIORITY_OPTIONS.map((o) => o.value));

const SELECT_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
};

export function GrievanceFilters({
  status = "",
  priority = "",
  search = "",
}: {
  status?: string;
  priority?: string;
  search?: string;
}) {
  const t = useTranslations("crmGrievanceFilters");
  const router = useRouter();
  const [searchText, setSearchText] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in step if the URL changes from elsewhere (e.g. Clear).
  useEffect(() => {
    setSearchText(search);
  }, [search]);

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  function pushQuery(next: { status?: string; priority?: string; search?: string }) {
    const qs = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.priority ?? priority;
    const q = next.search ?? searchText;
    // Validate against the known enums; a bogus value is simply dropped so it
    // never reaches the API.
    if (s && STATUS_VALUES.has(s)) qs.set("status", s);
    if (p && PRIORITY_VALUES.has(p)) qs.set("priority", p);
    if (q && q.trim()) qs.set("search", q.trim());
    // Any filter change resets to page 1.
    const str = qs.toString();
    router.replace(str ? `/crm/grievances?${str}` : "/crm/grievances");
  }

  const hasActiveFilters = Boolean(status || priority || search);

  return (
    <div
      style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", margin: "8px 0 12px" }}
      role="search"
      aria-label={t("filterAriaLabel")}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span style={{ color: "var(--ink2)" }}>{t("statusLabel")}</span>
        <select
          aria-label={t("filterByStatus")}
          value={STATUS_VALUES.has(status) ? status : ""}
          onChange={(e) => pushQuery({ status: e.target.value })}
          style={SELECT_STYLE}
        >
          <option value="">{t("allStatuses")}</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        <span style={{ color: "var(--ink2)" }}>{t("priorityLabel")}</span>
        <select
          aria-label={t("filterByPriority")}
          value={PRIORITY_VALUES.has(priority) ? priority : ""}
          onChange={(e) => pushQuery({ priority: e.target.value })}
          style={SELECT_STYLE}
        >
          <option value="">{t("allPriorities")}</option>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: "1 1 220px" }}>
        <span style={{ color: "var(--ink2)" }}>{t("searchLabel")}</span>
        <input
          aria-label={t("searchAriaLabel")}
          type="search"
          value={searchText}
          placeholder={t("searchPlaceholder")}
          onChange={(e) => {
            const v = e.target.value;
            setSearchText(v);
            if (debounce.current) clearTimeout(debounce.current);
            debounce.current = setTimeout(() => pushQuery({ search: v }), 400);
          }}
          style={{ ...SELECT_STYLE, width: "100%", boxSizing: "border-box" }}
        />
      </label>

      {hasActiveFilters && (
        <a href="/crm/grievances" className="btn" style={{ fontSize: 13 }}>
          {t("clearFilters")}
        </a>
      )}
    </div>
  );
}
