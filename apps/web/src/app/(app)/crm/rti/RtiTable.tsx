"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmRtiRow } from "../../../_data/loaders";

// ---------------------------------------------------------------------------
// SLA badge
// ---------------------------------------------------------------------------

function SlaBadge({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) return null;
  const msLeft = new Date(dueAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
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
}: {
  rows: CrmRtiRow[];
  source?: "api" | "error";
}) {
  const {
    data: rows,
    provenance,
    offline,
    cachedAt,
  } = useSeededResource<CrmRtiRow[]>(
    "crm.rti",
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
                    {new Date(r.dueAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
                <SlaBadge dueAt={r.dueAt} />
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
