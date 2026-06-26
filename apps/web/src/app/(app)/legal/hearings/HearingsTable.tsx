"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog, DataTable, Segmented } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Hearing = {
  id: string;
  caseId: string;
  caseNo: string;
  caseTitle?: string | null;
  court: string;
  date: string;
  time?: string | null;
  purpose?: string | null;
  /** ISO date string for the next scheduled hearing, used for the SLA countdown. */
  nextDate?: string | null;
  status: string;
} & Record<string, unknown>;

const FILTERS = ["This week", "Today"] as const;

function hearingStatusPill(status: string): ReactNode {
  switch (status) {
    case "completed":
      return <span className="pill good">Listed</span>;
    case "adjourned":
      return <span className="pill warn">Adjourned</span>;
    case "cancelled":
      return <span className="pill bad">Cancelled</span>;
    default:
      return <span className="pill info">Listed</span>;
  }
}

/**
 * Days-to-hearing countdown.
 * Returns whole days remaining (negative = overdue).
 * Null if no date is available.
 */
function daysRemaining(dateStr: string | null | undefined, today: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const t = new Date(today);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

/** Colour-coded countdown cell (red if overdue, amber ≤7, green otherwise). */
function daysCell(n: number | null): ReactNode {
  if (n === null) return <span style={{ color: "var(--muted, #94a3b8)" }}>—</span>;
  if (n < 0) {
    return (
      <span style={{ color: "#b42318", fontWeight: 600 }}>
        {`Overdue by ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`}
      </span>
    );
  }
  if (n === 0) {
    return <span style={{ color: "#b42318", fontWeight: 600 }}>Today</span>;
  }
  const color = n <= 7 ? "#b54708" : "#067647";
  const weight = n <= 7 ? 600 : 400;
  return (
    <span style={{ color, fontWeight: weight }}>
      {`${n} day${n === 1 ? "" : "s"}`}
    </span>
  );
}

type HearingRow = {
  id: string;
  caseId: string;
  caseNo: string;
  caseTitle: string;
  court: string;
  dateDisplay: string;
  /** Raw ISO date string (for formatIndianDate fallback in reminder dialog) */
  rawDate: string;
  purpose: string;
  status: string;
  statusNode: ReactNode;
  daysToHearing: number | null;
  /** ISO string used by the reminder POST */
  nextDateIso: string | null;
} & Record<string, unknown>;

export function HearingsTable({ items, source = "api" }: { items: Hearing[]; source?: "api" | "error" }) {
  const router = useRouter();
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Hearing[]>(
    "legal.hearings",
    items,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("This week");

  // Reminder dialog state
  const [reminderRow, setReminderRow] = useState<HearingRow | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState<string | undefined>(undefined);

  const today = new Date().toISOString().slice(0, 10);

  const visible = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    if (filter === "Today") return sorted.filter((r) => r.date === today);
    if (filter === "This week") return sorted.filter((r) => r.date >= today && r.date <= weekEnd);
    return sorted;
  }, [rows, filter, today]);

  const tableRows: HearingRow[] = useMemo(
    () =>
      visible.map((r) => {
        // Prefer nextDate for the countdown (upcoming re-listing), fall back to date.
        const countdownDate = (r.nextDate as string | null | undefined) ?? r.date;
        return {
          id: r.id,
          caseId: r.caseId,
          caseNo: r.caseNo,
          caseTitle: (r.caseTitle as string | null | undefined) ?? r.caseNo,
          court: r.court,
          dateDisplay: `${formatIndianDate(r.date)}${r.time ? ` · ${r.time}` : ""}`,
          rawDate: r.date,
          purpose: r.purpose ?? "—",
          status: r.status,
          statusNode: hearingStatusPill(r.status),
          daysToHearing: daysRemaining(countdownDate, today),
          nextDateIso: countdownDate ?? null,
        };
      }),
    [visible, today],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  async function handleSetReminder(): Promise<void> {
    if (!reminderRow) return;
    const { caseId, caseTitle, nextDateIso } = reminderRow;
    if (!nextDateIso) {
      setReminderError("No hearing date available to set a reminder against.");
      return;
    }
    setReminderBusy(true);
    setReminderError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/reminder`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            remindAt: new Date(nextDateIso).toISOString(),
            message: `Hearing reminder — ${caseTitle}`,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        setReminderError(text || `Request failed (${res.status})`);
        setReminderBusy(false);
        return;
      }
      setReminderBusy(false);
      setReminderRow(null);
      router.refresh();
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : "Network error");
      setReminderBusy(false);
    }
  }

  const columns: Array<{
    key: keyof HearingRow & string;
    label: string;
    render?: (r: HearingRow) => ReactNode;
    sortable?: boolean;
  }> = [
    {
      key: "dateDisplay",
      label: "Date & time",
    },
    {
      key: "caseNo",
      label: "Case No.",
      render: (r) => <span className="mono">{r.caseNo}</span>,
    },
    { key: "court", label: "Court" },
    { key: "purpose", label: "Purpose" },
    {
      key: "statusNode",
      label: "Status",
      render: (r) => r.statusNode,
      sortable: false,
    },
    {
      key: "daysToHearing",
      label: "Days to hearing",
      render: (r) => daysCell(r.daysToHearing),
    },
    {
      key: "id",
      label: "Actions",
      sortable: false,
      render: (r) => (
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: "0.8rem", padding: "4px 10px", minHeight: 32 }}
          onClick={(e) => {
            e.stopPropagation();
            setReminderError(undefined);
            setReminderRow(r);
          }}
          aria-label={`Set reminder for hearing on case ${r.caseNo}`}
        >
          Set Reminder
        </button>
      ),
    },
  ];

  return (
    <div className="card">
      <div className="card-h">
        <h3>Hearing schedule</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<HearingRow>
        columns={columns}
        rows={tableRows}
        rowHref={(r) => `/legal/cases/${r.caseId}`}
        sortable
        filterable
        filterPlaceholder="Filter hearings…"
        pageSize={15}
      />

      <ConfirmDialog
        open={reminderRow !== null}
        title="Set hearing reminder"
        description={
          reminderRow
            ? `A reminder will be posted for "${reminderRow.caseTitle}" on ${formatIndianDate(reminderRow.nextDateIso ?? reminderRow.rawDate)}.`
            : undefined
        }
        confirmLabel="Set reminder"
        requireReason={false}
        busy={reminderBusy}
        errorMessage={reminderError}
        onConfirm={() => void handleSetReminder()}
        onCancel={() => {
          if (!reminderBusy) {
            setReminderRow(null);
            setReminderError(undefined);
          }
        }}
      />
    </div>
  );
}
