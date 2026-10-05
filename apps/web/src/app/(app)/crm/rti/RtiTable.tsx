"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmRtiRow } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { isRtiClosed, rtiDaysLeft } from "./rtiStatus";

// ---------------------------------------------------------------------------
// SLA badge
// ---------------------------------------------------------------------------

/**
 * GAP-CRM-RTI-01: the SLA badge now honours status. A RESPONDED / REJECTED /
 * DISPOSED request is no longer running against the 30-day statutory clock,
 * so it must NOT show a red "N d overdue" badge (which reads as an ongoing
 * statutory breach). Those rows get a neutral "Closed" badge instead; only
 * genuinely open requests keep the live countdown. Day arithmetic is shared
 * with the tile counts (rtiDaysLeft) and done on IST calendar days, not a
 * `Math.ceil(ms)` diff that shifted by the time of day the page rendered.
 */
function SlaBadge({ status, dueAt }: { status: string; dueAt: string | null }) {
  const t = useTranslations("crmRtiTable");
  if (isRtiClosed(status)) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 600,
          background: "color-mix(in srgb, var(--ink2) 12%, transparent)",
          color: "var(--ink2)",
          whiteSpace: "nowrap",
        }}
      >
        {t("closed")}
      </span>
    );
  }
  if (!dueAt) return null;
  const daysLeft = rtiDaysLeft(dueAt);
  if (daysLeft === null) return null;
  const overdue = daysLeft < 0;
  const color =
    overdue || daysLeft < 7
      ? "var(--bad)"
      : daysLeft < 14
        ? "var(--warn)"
        : "var(--good)";
  const label = overdue
    ? t("daysOverdue", { days: Math.abs(daysLeft) })
    : t("daysLeft", { days: daysLeft });
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section label — GAP-CRM-RTI-06: shared via @/lib/crm/rti so the table, the
// detail page and the new-request form can never drift. The full statutory
// label is used everywhere so all three screens read identically.
// ---------------------------------------------------------------------------

function sectionLabel(s: string, t: (key: string) => string) {
  if (s === "s.6") return t("section6");
  if (s === "s.11") return t("section11");
  return s;
}

/**
 * GAP-CRM-RTI-04: an RTI applicant's name is personal data under DPDP. In the
 * register list it is shown in a reduced form to a viewer without PII-read
 * permission — the first name plus a masked surname ("Anil S••••") — enough to
 * recognise a row without exposing the full identity to everyone with CRM
 * access. The full name remains available on the detail page. Server-side
 * search still matches the full name (this only changes what is displayed).
 */
export function maskApplicantName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "—";
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (parts.length === 1) {
    // Single token: show the first character, mask the rest.
    return first.length <= 1 ? first : `${first[0]}${"•".repeat(Math.min(first.length - 1, 6))}`;
  }
  const rest = parts.slice(1).join(" ");
  const surnameInitial = rest[0] ?? "";
  return `${first} ${surnameInitial}${"•".repeat(Math.min(Math.max(rest.length - 1, 1), 6))}`;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function RtiTable({
  rows: seedRows,
  source = "api",
  page = 1,
  canRevealPii = false,
  hasFilters = false,
}: {
  rows: CrmRtiRow[];
  source?: "api" | "error";
  /** 1-based server page — part of the cache key so pages don't overwrite each other. */
  page?: number;
  /**
   * GAP-CRM-RTI-04: whether the viewer may see applicant names in the clear
   * (CRM_PII_READ_ROLES, resolved server-side on the page). When false, the
   * list shows a reduced form; the detail page remains the place for the full
   * name. The server stays the authority on what data it returns.
   */
  canRevealPii?: boolean;
  /**
   * GAP-CRM-RTI-05: whether any status/section/search filter is active, so the
   * empty state can say "none recorded yet" vs. "none match the filters".
   */
  hasFilters?: boolean;
}) {
  const t = useTranslations("crmRtiTable");
  const {
    data: rows,
    provenance,
    offline,
    cachedAt,
  } = useSeededResource<CrmRtiRow[]>(
    // GAP-CRM-RTI-02: scope the offline cache per server page, otherwise
    // navigating to page 2 would overwrite page 1's cached rows under the
    // same key, so an offline reader could never get back to page 1.
    `crm.rti:p${page}`,
    seedRows,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<CrmRtiRow>
        columns={[
          {
            key: "referenceNo",
            label: t("colReferenceNo"),
            render: (r) => (
              <Link
                href={`/crm/rti/${r.id}`}
                style={{ color: "var(--link)", textDecoration: "none", fontSize: 12, fontFamily: "monospace" }}
              >
                {r.referenceNo || "—"}
              </Link>
            ),
          },
          {
            key: "section",
            label: t("colSection"),
            render: (r) => (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "color-mix(in srgb, var(--ink2) 10%, transparent)",
                  color: "var(--ink2)",
                }}
              >
                {sectionLabel(r.section, t)}
              </span>
            ),
          },
          {
            key: "departmentRef",
            label: t("colDepartment"),
            render: (r) => (
              <span style={{ fontSize: 13, color: "var(--ink)" }}>{r.departmentRef}</span>
            ),
          },
          {
            key: "applicantName",
            label: t("colApplicant"),
            render: (r) => (
              <span style={{ fontSize: 13, color: "var(--ink)" }}>
                {canRevealPii ? r.applicantName : maskApplicantName(r.applicantName)}
              </span>
            ),
          },
          {
            key: "dueAt",
            label: t("colDueSla"),
            render: (r) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {r.dueAt && (
                  <span style={{ fontSize: 11, color: "var(--ink2)" }}>
                    {formatIndianDate(r.dueAt)}
                  </span>
                )}
                <SlaBadge status={r.status} dueAt={r.dueAt} />
              </div>
            ),
          },
          {
            key: "status",
            label: t("colStatus"),
            render: (r) => (
              // GAP-CRM-RTI-03: no label override — StatusPill humanises the
              // raw enum ("FIRST_APPEAL" -> "First appeal") and maps the tone.
              <StatusPill status={r.status} />
            ),
          },
        ]}
        rows={rows}
        emptyMessage={
          hasFilters
            ? t("emptyFiltered")
            : t("emptyNone")
        }
      />
    </>
  );
}
