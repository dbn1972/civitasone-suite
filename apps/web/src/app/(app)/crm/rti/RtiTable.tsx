"use client";

import Link from "next/link";
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
        Closed
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
    ? `${Math.abs(daysLeft)}d overdue`
    : `${daysLeft}d left`;
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
// Status chip colours
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  RECEIVED: "var(--ink2)",
  TRANSFERRED: "var(--link)",
  RESPONDED: "var(--good)",
  REJECTED: "var(--bad)",
  FIRST_APPEAL: "var(--warn)",
  SECOND_APPEAL: "var(--warn)",
  DISPOSED: "var(--ink2)",
};

function sectionLabel(s: string) {
  if (s === "s.6") return "§6 Information";
  if (s === "s.11") return "§11 Third-party";
  return s;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function RtiTable({
  rows: seedRows,
  source = "api",
  page = 1,
}: {
  rows: CrmRtiRow[];
  source?: "api" | "error";
  /** 1-based server page — part of the cache key so pages don't overwrite each other. */
  page?: number;
}) {
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
            label: "Reference No.",
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
            label: "Section",
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
                {sectionLabel(r.section)}
              </span>
            ),
          },
          {
            key: "departmentRef",
            label: "Department",
            render: (r) => (
              <span style={{ fontSize: 13, color: "var(--ink)" }}>{r.departmentRef}</span>
            ),
          },
          {
            key: "applicantName",
            label: "Applicant",
            render: (r) => (
              <span style={{ fontSize: 13, color: "var(--ink)" }}>{r.applicantName}</span>
            ),
          },
          {
            key: "dueAt",
            label: "Due Date / SLA",
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
            label: "Status",
            render: (r) => (
              <StatusPill
                label={r.status}
                status={r.status}
              />
            ),
          },
        ]}
        rows={rows}
        emptyMessage="No RTI requests match the current filters."
      />
    </>
  );
}
