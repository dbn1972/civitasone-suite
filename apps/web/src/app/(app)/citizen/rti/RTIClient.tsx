"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, EmptyState, ConfirmDialog } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface RTIApplication {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority?: string | null;
  filedDate?: string | null;
  deadlineDate?: string | null;
  status: string;
  isFirstAppeal: boolean;
}

interface Props {
  rtis: RTIApplication[];
  today: string;
}

const SEG_OPTIONS = ["All", "Due", "Overdue"];

/** RTI Act 2005 §7: 30-day statutory clock. Returns whole days remaining
 * (negative = days past the deadline). null when no deadline / already closed. */
function daysRemaining(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  const t = new Date(today);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

const CLOSED = new Set(["replied", "closed", "appeal"]);
/** Statuses that allow transfer under RTI Act §6(3) (within 5 days). */
const TRANSFERABLE = new Set(["received", "under_review"]);

interface Row extends Record<string, unknown> {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority: string;
  filedDate: string;
  deadlineDate: string;
  daysLeft: number | null;
  closed: boolean;
  status: string;
  firstAppeal: string;
}

type ClockLabels = {
  closed: string;
  overdueBy: (count: number) => string;
  dueToday: string;
  daysLeft: (count: number) => string;
};

/** Statutory clock cell — colour AND text (never colour alone, WCAG 1.4.1). */
function clockCell(row: Row, labels: ClockLabels) {
  if (row.closed) {
    return <span style={{ color: "var(--muted)" }}>{labels.closed}</span>;
  }
  const n = row.daysLeft;
  if (n === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (n < 0) {
    return <span style={{ color: "#b42318", fontWeight: 600 }}>{labels.overdueBy(Math.abs(n))}</span>;
  }
  if (n === 0) {
    return <span style={{ color: "#b42318", fontWeight: 600 }}>{labels.dueToday}</span>;
  }
  const color = n <= 5 ? "#b54708" : "#067647";
  return <span style={{ color, fontWeight: n <= 5 ? 600 : 400 }}>{labels.daysLeft(n)}</span>;
}


export function RTIClient({ rtis, today }: Props) {
  const t = useTranslations("citizenRti");
  const [active, setActive] = useState("All");
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | undefined>(undefined);

  const labels: ClockLabels = {
    closed: t("closed"),
    overdueBy: (count) => t("overdueBy", { count }),
    dueToday: t("dueToday"),
    daysLeft: (count) => t("daysLeft", { count }),
  };

  async function handleTransfer(toAuthority: string | undefined) {
    if (!transferId || !toAuthority?.trim()) return;
    setTransferBusy(true);
    setTransferError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/citizen/rti/${transferId}/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toAuthority: toAuthority.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        setTransferError(text || `Request failed (${res.status})`);
        setTransferBusy(false);
        return;
      }
      setTransferBusy(false);
      setTransferId(null);
      // Soft-refresh: the server component will revalidate on next navigation.
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Network error");
      setTransferBusy(false);
    }
  }

  const isDue = (r: RTIApplication) =>
    (r.status === "received" || r.status === "under_review" || r.status === "forwarded");
  const isOverdue = (r: RTIApplication) => {
    const n = daysRemaining(r.deadlineDate, today);
    return n !== null && n < 0 && !CLOSED.has(r.status);
  };

  const filtered =
    active === "Due"
      ? rtis.filter(isDue)
      : active === "Overdue"
      ? rtis.filter(isOverdue)
      : rtis;

  const rows: Row[] = filtered.map((r) => ({
    id: r.id,
    rtiNo: r.rtiNo,
    applicantName: r.applicantName,
    subject: r.subject,
    publicAuthority: r.publicAuthority ?? "—",
    filedDate: formatIndianDate(r.filedDate),
    deadlineDate: formatIndianDate(r.deadlineDate),
    daysLeft: daysRemaining(r.deadlineDate, today),
    closed: CLOSED.has(r.status),
    status: r.status,
    firstAppeal: r.isFirstAppeal ? "Yes" : "No",
  }));

  const COLUMNS = [
    { key: "rtiNo" as const, label: t("colRtiNo") },
    { key: "applicantName" as const, label: t("colApplicant") },
    { key: "subject" as const, label: t("colSubject") },
    { key: "publicAuthority" as const, label: t("colPublicAuthority") },
    { key: "filedDate" as const, label: t("colFiled") },
    { key: "deadlineDate" as const, label: t("colDeadline") },
    { key: "daysLeft" as const, label: t("colStatutoryClock"), render: (row: Row) => clockCell(row, labels) },
    { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
    { key: "firstAppeal" as const, label: t("colFirstAppeal") },
    {
      key: "id" as const,
      label: t("colActions"),
      render: (row: Row) =>
        TRANSFERABLE.has(row.status) ? (
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: "0.8rem", padding: "4px 10px", minHeight: 32 }}
            onClick={() => {
              setTransferError(undefined);
              setTransferId(row.id);
            }}
            aria-label={t("transferAriaLabel", { rtiNo: row.rtiNo })}
          >
            {t("transfer")}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("applicationListTitle")}</h3>
        <div role="group" aria-label={t("filterAriaLabel")}>
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {rtis.length === 0 ? (
        <EmptyState icon="📄" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          sortable
          filterable
          pageSize={15}
          rowLinkKey="id"
          rowLinkPrefix="/citizen/rti/"
        />
      )}
      <ConfirmDialog
        open={transferId !== null}
        title={t("transferDialogTitle")}
        description={t("transferDialogDescription")}
        confirmLabel={t("transfer")}
        requireReason
        reasonLabel="Transfer to (public authority name)"
        busy={transferBusy}
        errorMessage={transferError}
        onConfirm={(reason) => void handleTransfer(reason)}
        onCancel={() => {
          if (!transferBusy) {
            setTransferId(null);
            setTransferError(undefined);
          }
        }}
      />
    </div>
  );
}
