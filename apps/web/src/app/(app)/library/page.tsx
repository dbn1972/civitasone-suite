"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "../../_components/ds";

type Severity = "critical" | "high" | "medium" | "low" | "info";

type AuditIssue = {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  category: string;
  remediationSummary: string;
  affectedCount: number;
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

const MOCK_ISSUES: AuditIssue[] = [
  {
    id: "1",
    code: "W1",
    title: "Missing alt text on images",
    severity: "critical",
    category: "Accessibility",
    remediationSummary: "Add descriptive alt attributes to all non-decorative <img> elements.",
    affectedCount: 14,
  },
  {
    id: "2",
    code: "W2",
    title: "Insufficient colour contrast",
    severity: "high",
    category: "Accessibility",
    remediationSummary: "Ensure text/background contrast ratio meets WCAG 2.2 AA minimum of 4.5:1.",
    affectedCount: 7,
  },
  {
    id: "3",
    code: "W3",
    title: "Form inputs missing associated labels",
    severity: "high",
    category: "Accessibility",
    remediationSummary: "Link every input to a <label> via htmlFor/id or aria-label.",
    affectedCount: 9,
  },
  {
    id: "4",
    code: "W4",
    title: "Missing CSRF protection on state-changing APIs",
    severity: "critical",
    category: "Security",
    remediationSummary: "Implement SameSite=Strict cookies and double-submit token pattern for POST/PUT/DELETE routes.",
    affectedCount: 3,
  },
  {
    id: "5",
    code: "W5",
    title: "Loading skeleton missing on async pages",
    severity: "medium",
    category: "UX",
    remediationSummary: "Add Next.js loading.tsx siblings or isLoading guard with skeleton placeholders to prevent content flash.",
    affectedCount: 5,
  },
  {
    id: "6",
    code: "W6",
    title: "Index-based React list keys",
    severity: "medium",
    category: "Performance",
    remediationSummary: "Replace key={index} with stable unique identifiers (id, slug, or composite) to prevent reconciliation bugs.",
    affectedCount: 11,
  },
  {
    id: "7",
    code: "W7",
    title: "Unthrottled search inputs triggering excessive API calls",
    severity: "low",
    category: "Performance",
    remediationSummary: "Debounce search onChange handlers with a 250–350 ms delay before issuing fetch requests.",
    affectedCount: 4,
  },
  {
    id: "8",
    code: "I1",
    title: "No focus-visible ring on interactive elements",
    severity: "medium",
    category: "Accessibility",
    remediationSummary: "Apply :focus-visible outline styles conforming to WCAG 2.4.11 (min 2px offset, non-colour-only).",
    affectedCount: 22,
  },
];

export default function LibraryPage() {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/v1/audit/library/issues")
      .then((r) => r.json())
      .then((body: { data?: AuditIssue[] }) => {
        setIssues(body.data ?? MOCK_ISSUES);
      })
      .catch(() => {
        setIssues(MOCK_ISSUES);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const filtered = isLoading
    ? []
    : issues.filter((iss) => {
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
        subtitle="Catalogue of UX, accessibility, security, and performance findings with remediation guidance."
        back="/admin"
      />

      {isLoading ? (
        /* Skeleton prevents empty-state flash while fetching issues */
        <div className="animate-pulse" aria-busy="true" aria-label="Loading issue library">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            {[1, 2].map((n) => (
              <div key={n} style={{ height: 44, borderRadius: 8, background: "var(--panel)" }} />
            ))}
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} style={{ height: 96, borderRadius: 12, background: "var(--panel)" }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Filter bar */}
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

          {/* Issue cards */}
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
                    <span aria-label={`${iss.affectedCount} affected locations`}>
                      {iss.affectedCount} location{iss.affectedCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
