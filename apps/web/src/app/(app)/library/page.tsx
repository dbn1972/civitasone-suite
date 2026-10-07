"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../_components/ds";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type AuditIssue = {
  id: string;
  code: string;
  severity: Severity;
  // i18n message keys (resolved at render via useTranslations) so titles,
  // remediation text and category labels switch with the active locale.
  titleKey: string;
  remediationKey: string;
  categoryKey: string;
};

// GAP-LIBRARY-HOME-04: severity swatches now use this codebase's existing
// semantic design tokens from civitas-ds.css only — no raw hex. The former
// literal pairs #2563eb/#eff6ff (medium) and #6b7280/#f9fafb (info) are gone.
// critical/high/low already used --bad/--warn/--good (verified >=4.5:1 in the
// prior UX-005 tranche); medium now uses --info (#175cd3 on #eff8ff = 6.37:1)
// and info uses --mut (#667085, 4.97:1 on white) on --line2 (#f2f4f7, 4.63:1),
// both clearing WCAG 2.2 AA for the chip text.
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--bad)",
  high: "var(--warn)",
  medium: "var(--info)",
  low: "var(--good)",
  info: "var(--mut)",
};

const SEVERITY_BG: Record<Severity, string> = {
  critical: "var(--badbg)",
  high: "var(--warnbg)",
  medium: "var(--infobg)",
  low: "var(--goodbg)",
  info: "var(--line2)",
};

// GAP-LIBRARY-HOME-01 / HOME-03 / HOME-05: this is a genuinely static,
// developer-maintained reference list of finding TYPES (the same for every
// tenant, no fetch/loader/source). It is NOT the document/book library — that
// lives at /estab/library. The route is now titled "Audit finding types"
// (library.pageTitle) and gated to platform admins by library/layout.tsx, so
// the generic "Library" name is left to /estab/library and tenant-role users
// no longer land on engineering findings. Codes and strings are next-intl keys
// (see the `library` namespace in messages/en.json + hi.json) and a legend
// explains the W/I code prefixes.
// static reference: developer-authored audit-finding-type catalogue (i18n keys), identical for every tenant; not backend data.
const ISSUE_LIBRARY: AuditIssue[] = [
  { id: "1", code: "W1", severity: "critical", titleKey: "issue_W1_title", remediationKey: "issue_W1_remediation", categoryKey: "catAccessibility" },
  { id: "2", code: "W2", severity: "high", titleKey: "issue_W2_title", remediationKey: "issue_W2_remediation", categoryKey: "catAccessibility" },
  { id: "3", code: "W3", severity: "high", titleKey: "issue_W3_title", remediationKey: "issue_W3_remediation", categoryKey: "catAccessibility" },
  { id: "4", code: "W4", severity: "critical", titleKey: "issue_W4_title", remediationKey: "issue_W4_remediation", categoryKey: "catSecurity" },
  { id: "5", code: "W5", severity: "medium", titleKey: "issue_W5_title", remediationKey: "issue_W5_remediation", categoryKey: "catUx" },
  { id: "6", code: "W6", severity: "medium", titleKey: "issue_W6_title", remediationKey: "issue_W6_remediation", categoryKey: "catPerformance" },
  { id: "7", code: "W7", severity: "low", titleKey: "issue_W7_title", remediationKey: "issue_W7_remediation", categoryKey: "catPerformance" },
  { id: "8", code: "I1", severity: "medium", titleKey: "issue_I1_title", remediationKey: "issue_I1_remediation", categoryKey: "catAccessibility" },
];

export default function LibraryPage() {
  const t = useTranslations("library");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Resolve each issue's localised strings once, so search matches what the
  // user actually sees in the current locale.
  const localised = ISSUE_LIBRARY.map((iss) => ({
    ...iss,
    title: t(iss.titleKey),
    remediation: t(iss.remediationKey),
    category: t(iss.categoryKey),
  }));

  const filtered = localised.filter((iss) => {
    const matchSev = severityFilter === "all" || iss.severity === severityFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      iss.title.toLowerCase().includes(q) ||
      iss.code.toLowerCase().includes(q) ||
      iss.category.toLowerCase().includes(q);
    return matchSev && matchSearch;
  });

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--line, #d1d5db)",
    fontSize: 14,
    background: "var(--bg)",
    color: "var(--ink)",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ink2)",
    marginBottom: 4,
  };

  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/admin" />

      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--ink3)" }}>{t("staticNotice")}</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <label htmlFor="library-search" style={labelStyle}>
            {t("searchLabel")}
          </label>
          <input
            id="library-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="library-severity" style={labelStyle}>
            {t("severityLabel")}
          </label>
          <select
            id="library-severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          >
            <option value="all">{t("severityAll")}</option>
            <option value="critical">{t("sevCritical")}</option>
            <option value="high">{t("sevHigh")}</option>
            <option value="medium">{t("sevMedium")}</option>
            <option value="low">{t("sevLow")}</option>
            <option value="info">{t("sevInfo")}</option>
          </select>
        </div>
      </div>

      {/* GAP-LIBRARY-HOME-05: legend explaining the W/I code prefixes. */}
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink2)" }}>{t("legend")}</p>

      {filtered.length === 0 ? ( // ux-001-ok: `filtered` is a client-side filter of the hardcoded, static ISSUE_LIBRARY reference catalogue (see comment above) by the operator's own search/severity selections -- there is no fetch/loader/source in this path
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            color: "var(--ink2)",
            fontSize: 15,
          }}
        >
          {t("emptyState")}
        </div>
      ) : (
        <ul
          style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}
          aria-label={t("issuesAriaLabel")}
        >
          {filtered.map((iss) => (
            <li
              key={iss.id}
              className="card"
              style={{
                padding: 18,
                borderInlineStart: `4px solid ${SEVERITY_COLOR[iss.severity]}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    background: "var(--panel)",
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  {iss.code}
                </span>
                <strong style={{ fontSize: 15 }}>{iss.title}</strong>
                <span
                  style={{
                    marginInlineStart: "auto",
                    fontSize: 12,
                    fontWeight: 600,
                    color: SEVERITY_COLOR[iss.severity],
                    background: SEVERITY_BG[iss.severity],
                    padding: "2px 8px",
                    borderRadius: 99,
                    textTransform: "capitalize",
                  }}
                >
                  {t(`sev${iss.severity.charAt(0).toUpperCase()}${iss.severity.slice(1)}`)}
                </span>
              </div>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600 }}>{t("remediationLabel")}</span> {iss.remediation}
              </p>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink2)" }}>
                <span>{iss.category}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
