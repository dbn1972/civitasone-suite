"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, EmptyState, ConfirmDialog, Button } from "@/app/_components/ds";
import { maskName } from "@/app/_components/ds/Masked";
import { formatIndianDate, daysUntilIST } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { isRtiClosed } from "@/lib/rtiStatus";

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
  /** GAP-CITIZEN-RTI-06: when false, the applicant name is masked (DPDP). */
  canSeePii?: boolean;
}

const SEG_VALUES = ["All", "Due", "Overdue"] as const;

/** RTI Act 2005 §7: 30-day statutory clock. Returns whole days remaining
 * (negative = days past the deadline). null when no deadline.
 * GAP-CITIZEN-RTI-07/DETAIL-04: delegate to daysUntilIST so the day count is
 * computed in Asia/Kolkata calendar days — identical to the detail view and
 * stable regardless of the browser/server timezone (no local-midnight skew). */
function daysRemaining(deadline: string | null | undefined): number | null {
  return daysUntilIST(deadline);
}

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


export function RTIClient({ rtis, canSeePii = false }: Props) {
  const t = useTranslations("citizenRti");
  const router = useRouter();
  const [active, setActive] = useState("All" as (typeof SEG_VALUES)[number]);
  const [transferId, setTransferId] = useState(null as string | null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState(undefined as string | undefined);
  // GAP-CITIZEN-RTI-02: confirm the transfer worked and stop offering it again.
  const [notice, setNotice] = useState("");
  const [forwardedIds, setForwardedIds] = useState<Set<string>>(() => new Set());
  const formError = useFormError("RTI transfer");

  // GAP-CITIZEN-RTI-07: segment labels are i18n; the internal filter values
  // (SEG_VALUES) stay stable English keys so the filtering logic is unaffected.
  const segLabels: Record<(typeof SEG_VALUES)[number], string> = {
    All: t("segAll"),
    Due: t("segOpen"),
    Overdue: t("segOverdue"),
  };
  const segOptions = SEG_VALUES.map((v) => segLabels[v]);

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
        setTransferError((await formError.fromResponse(res, "save")).message);
        setTransferBusy(false);
        return;
      }
      const forwardedId = transferId;
      const authority = toAuthority.trim();
      setTransferBusy(false);
      setTransferId(null);
      // GAP-CITIZEN-RTI-02: optimistically mark the row forwarded (hides its
      // Transfer button immediately) and show a §6(3) success notice, then
      // router.refresh() so the server component re-fetches the real status.
      setForwardedIds((prev) => {
        const next = new Set(prev);
        next.add(forwardedId);
        return next;
      });
      setNotice(t("transferSuccess", { authority }));
      router.refresh();
    } catch (caught) {
      setTransferError(formError.fromException("save", caught).message);
      setTransferBusy(false);
    }
  }

  // GAP-CITIZEN-RTI-04: "Due" segment == the page's "Open" stat (still within
  // the §7 clock, i.e. not closed), so the stat count and the filtered rows agree.
  const isDue = (r: RTIApplication) => !isRtiClosed(r.status);
  const isOverdue = (r: RTIApplication) => {
    const n = daysRemaining(r.deadlineDate);
    return n !== null && n < 0 && !isRtiClosed(r.status);
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
    applicantName: canSeePii ? r.applicantName : maskName(r.applicantName),
    subject: r.subject,
    publicAuthority: r.publicAuthority ?? "—",
    filedDate: formatIndianDate(r.filedDate),
    deadlineDate: formatIndianDate(r.deadlineDate),
    daysLeft: daysRemaining(r.deadlineDate),
    closed: isRtiClosed(r.status),
    status: r.status,
    firstAppeal: r.isFirstAppeal ? t("yes") : t("no"),
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
        TRANSFERABLE.has(row.status) && !forwardedIds.has(row.id) ? (
          <Button
            type="button"
            variant="ghost"
            style={{ fontSize: "0.8rem", padding: "4px 10px", minHeight: 32 }}
            onClick={() => {
              setTransferError(undefined);
              setTransferId(row.id);
            }}
            aria-label={t("transferAriaLabel", { rtiNo: row.rtiNo })}
          >
            {t("transfer")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("applicationListTitle")}</h3>
        <div role="group" aria-label={t("filterAriaLabel")}>
          <Segmented
            value={segLabels[active]}
            onChange={(label) => {
              const v = SEG_VALUES.find((k) => segLabels[k] === label);
              if (v) setActive(v);
            }}
            options={segOptions}
          />
        </div>
      </div>
      {notice ? (
        <p role="status" aria-live="polite" className="pad" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {notice}
        </p>
      ) : null}
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
        reasonLabel={t("transferReasonLabel")}
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
