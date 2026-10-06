import Link from "next/link";
import { PageHeader, Card, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole, MEETING_CREATE_ROLES } from "@/lib/auth/roleGuard";
import { getMeetingsPage } from "../_data/loaders";
import { fmtDateTime, humanize, meetingPillStatus, meetingStatusLabel } from "../_data/format";
import type { MeetingStatus } from "../_data/types";

export const dynamic = "force-dynamic";

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

const STATUS_FILTERS: { value: "" | MeetingStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "agenda_locked", label: "Agenda locked" },
  { value: "in_progress", label: "In progress" },
  { value: "adjourned", label: "Adjourned" },
  { value: "minutes_pending", label: "Minutes pending" },
  { value: "minutes_approved", label: "Minutes approved" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
];

const PAGE_SIZE = 25;

const VALID_STATUSES = new Set(STATUS_FILTERS.map((s) => s.value).filter(Boolean) as string[]);

export default async function MeetingsListPage({
  searchParams,
}: {
  searchParams?: { status?: string; page?: string };
}) {
  // GAP-MEETING-MEETINGS-01 / GAP-MEETING-HOME-03: read status + page from the
  // query so the home stat cards can drill through to a filtered, paginated
  // list instead of rendering every meeting the API returns.
  const statusParam = searchParams?.status;
  const status = statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as MeetingStatus) : undefined;
  const pageNum = Math.max(1, Number(searchParams?.page) || 1);

  const result = await getMeetingsPage({ status, page: pageNum, pageSize: PAGE_SIZE });
  const source = result.source;
  const { rows, total } = result.data;

  const roles = getSessionRoles();
  const canCreate = hasAnyRole(roles, MEETING_CREATE_ROLES);

  const errored = source === "error";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countLabel = errored ? "—" : String(total);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/meeting/meetings${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Every convened meeting. Open one to run the live console — agenda, attendance, quorum and voting."
        back="/meeting"
        backLabel="Meeting"
        actions={
          canCreate ? (
            <Link className="btn primary" href="/meeting/meetings/new">
              + New meeting
            </Link>
          ) : undefined
        }
      />

      {/* Status filter bar (GAP-MEETING-MEETINGS-01). Server-rendered links keep
          this a plain, JS-free navigation that honours the current filter. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 14px" }} role="navigation" aria-label="Filter meetings by status">
        {STATUS_FILTERS.map((f) => {
          const active = (f.value || undefined) === status;
          const href =
            f.value === "" ? "/meeting/meetings" : `/meeting/meetings?status=${f.value}`;
          return (
            <Link
              key={f.value || "all"}
              href={href}
              className={active ? "btn primary sm" : "btn ghost sm"}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <Card title={`All meetings (${countLabel})`} padding>
        {errored ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load the meetings list.",
              next: "Check your connection and try again.",
              actions: ["retry", "help"],
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title={status ? "No meetings match this filter" : "No meetings yet"}
            message={
              status
                ? "Try a different status filter, or clear the filter to see all meetings."
                : "Meetings convened by the secretariat will appear here."
            }
          />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={labelStyle}>Meeting</th>
                    <th style={labelStyle}>Type</th>
                    <th style={labelStyle}>Scheduled</th>
                    <th style={labelStyle}>Quorum</th>
                    <th style={labelStyle}>Status</th>
                    <th style={labelStyle}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.title || "Untitled meeting"}</div>
                        {m.meetingNumber && (
                          <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                            {m.meetingNumber}
                          </div>
                        )}
                      </td>
                      <td>{humanize(m.type)}</td>
                      <td style={monoStyle}>{fmtDateTime(m.scheduledAt)}</td>
                      <td>
                        {m.quorumEstablished ? (
                          <StatusPill status="active" label="Established" />
                        ) : (
                          <span style={{ color: "var(--ink2)" }}>Not yet</span>
                        )}
                      </td>
                      <td>
                        <StatusPill status={meetingPillStatus(m.status)} label={meetingStatusLabel(m.status)} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link className="btn ghost sm" href={`/meeting/meetings/${m.id}`}>
                          Open console →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav
                aria-label="Pagination"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}
              >
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                  Page {pageNum} of {totalPages} · {total} total
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  {pageNum > 1 && (
                    <Link className="btn ghost sm" href={buildHref(pageNum - 1)} rel="prev">
                      ← Previous
                    </Link>
                  )}
                  {pageNum < totalPages && (
                    <Link className="btn ghost sm" href={buildHref(pageNum + 1)} rel="next">
                      Next →
                    </Link>
                  )}
                </span>
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
