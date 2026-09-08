"use client";

import { useState } from "react";
import { PageHeader } from "../../_components/ds";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type AuditIssue = {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  category: string;
  remediationSummary: string;
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#dc2626",
  high: "#d97706",
  medium: "#2563eb",
  low: "#059669",
  info: "#6b7280",
};

const SEVERITY_BG: Record<Severity, string> = {
  critical: "#fef2f2",
  high: "#fffbeb",
  medium: "#eff6ff",
  low: "#ecfdf5",
  info: "#f9fafb",
};

// COMP-004: this page used to fetch GET /v1/audit/library/issues (which
// doesn't exist anywhere in the platform — grepped every service) and
// silently fall back to this exact list on failure, so a real network
// error was indistinguishable from "here is the live issue catalogue."
//
// Unlike admin/discovery and admin/bulk-scan (which needed a per-tenant
// backend that doesn't exist), this content is a genuinely static
// reference: a fixed catalogue of common UX/accessibility/security/
// performance finding TYPES with generic remediation guidance — the kind
// of thing that's the same for every tenant and edited by developers, not
// admin-entered data. Renamed from MOCK_ISSUES to ISSUE_LIBRARY and the
// fake fetch/loading-skeleton machinery removed: it is now honestly
// presented as what it is — a static reference list, not live/tenant data
// pretending to have loaded from a backend.
const ISSUE_LIBRARY: AuditIssue[] = [
  {
    id: "1",
    code: "W1",
    title: "Missing alt text on images",
    severity: "critical",
    category: "Accessibility",
    remediationSummary: "Add descriptive alt attributes to all non-decorative <img> elements.",
  },
  {
    id: "2",
    code: "W2",
    title: "Insufficient colour contrast",
    severity: "high",
    category: "Accessibility",
    remediationSummary: "Ensure text/background contrast ratio meets WCAG 2.2 AA minimum of 4.5:1.",
  },
  {
    id: "3",
    code: "W3",
    title: "Form inputs missing associated labels",
    severity: "high",
    category: "Accessibility",
    remediationSummary: "Link every input to a <label> via htmlFor/id or aria-label.",
  },
  {
    id: "4",
    code: "W4",
    title: "Missing CSRF protection on state-changing APIs",
    severity: "critical",
    category: "Security",
    remediationSummary: "Implement SameSite=Strict cookies and double-submit token pattern for POST/PUT/DELETE routes.",
  },
  {
    id: "5",
    code: "W5",
    title: "Loading skeleton missing on async pages",
    severity: "medium",
    category: "UX",
    remediationSummary: "Add Next.js loading.tsx siblings or isLoading guard with skeleton placeholders to prevent content flash.",
  },
  {
    id: "6",
    code: "W6",
    title: "Index-based React list keys",
    severity: "medium",
    category: "Performance",
    remediationSummary: "Replace key={index} with stable unique identifiers (id, slug, or composite) to prevent reconciliation bugs.",
  },
  {
    id: "7",
    code: "W7",
    title: "Unthrottled search inputs triggering excessive API calls",
    severity: "low",
    category: "Performance",
    remediationSummary: "Debounce search onChange handlers with a 250–350 ms delay before issuing fetch requests.",
  },
  {
    id: "8",
    code: "I1",
    title: "No focus-visible ring on interactive elements",
    severity: "medium",
    category: "Accessibility",
    remediationSummary: "Apply :focus-visible outline styles conforming to WCAG 2.4.11 (min 2px offset, non-colour-only).",
  },
];

export default function LibraryPage() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = ISSUE_LIBRARY.filter((iss) => {
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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Issue Library"
        subtitle="Reference catalogue of common UX, accessibility, security, and performance findings with remediation guidance."
        back="/admin"
      />

      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--ink3)" }}>
        This is a static reference catalogue — the same for every tenant, maintained by the development
        team — not a live scan result or per-tenant data.
      </p>

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
            Search issues
          </label>
          <input
            id="library-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, title or category…"
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="library-severity" style={labelStyle}>
            Severity
          </label>
          <select
            id="library-severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            color: "var(--ink2)",
            fontSize: 15,
          }}
        >
          No issues match your filters.
        </div>
      ) : (
        <ul
          style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}
          aria-label="Audit issues"
        >
          {filtered.map((iss) => (
            <li
              key={iss.id}
              className="card"
              style={{
                padding: 18,
                borderLeft: `4px solid ${SEVERITY_COLOR[iss.severity]}`,
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
                    marginLeft: "auto",
                    fontSize: 12,
                    fontWeight: 600,
                    color: SEVERITY_COLOR[iss.severity],
                    background: SEVERITY_BG[iss.severity],
                    padding: "2px 8px",
                    borderRadius: 99,
                    textTransform: "capitalize",
                  }}
                >
                  {iss.severity}
                </span>
              </div>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600 }}>Remediation:</span> {iss.remediationSummary}
              </p>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--ink2)" }}>
                <span>{iss.category}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
