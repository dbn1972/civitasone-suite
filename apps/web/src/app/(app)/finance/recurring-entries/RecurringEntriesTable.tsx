"use client";

/**
 * GAP-FINANCE-RECURRING-ENTRIES-01: the template list used to be read-only, so
 * a wrong standing instruction (say a mistyped ₹1,20,000 rent) could not be
 * paused or ended from the UI. Each row now has Pause / Resume and End now,
 * each behind a ConfirmDialog that restates the template's name, amount and
 * next run. They PATCH /v1/finance/recurring-entries/:id (isActive / endDate),
 * which finance-service role-gates (FINANCE_ROLES) and processes as an audited
 * command. The actions are offered only to those roles (`canWrite`), and an
 * already-ended template (inactive with a past end date) offers neither Resume
 * nor End: Resume would re-activate it while leaving the old end date.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, DataTable } from "@/app/_components/ds";
import { formatMoney, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export type RecurringEntryRow = {
  id: string;
  name: string;
  voucherType: string;
  frequency: string;
  amountMinor: string | number;
  nextRunDateDisplay: string;
  endDateDisplay: string;
  statusLabel: string;
  /** Inactive AND has an end date on or before today (set by the page). */
  ended?: boolean;
} & Record<string, unknown>;

type Action = "pause" | "resume" | "end";

/** The PATCH body each action sends (pure, so it is unit-testable). */
export function recurringActionBody(action: Action, today: string): { isActive: boolean; endDate?: string } {
  if (action === "pause") return { isActive: false };
  if (action === "resume") return { isActive: true };
  return { isActive: false, endDate: today };
}

type DisplayRow = RecurringEntryRow & { actions: string };

export function RecurringEntriesTable({ entries, canWrite = true }: { entries: RecurringEntryRow[]; canWrite?: boolean }) {
  const t = useTranslations("financeRecurringTable");
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: RecurringEntryRow; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  async function run() {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/finance/recurring-entries/${pending.row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(recurringActionBody(pending.action, todayIST())),
      });
      if (!(res.ok || res.status === 202)) {
        const human = toHumanError("save", { area: "recurring entry" });
        setDialogError(`${human.what} ${human.next}`);
        return;
      }
      setNotice(t("submitted"));
      setPending(null);
      router.refresh();
    } catch {
      const human = toHumanError("save", { area: "recurring entry" });
      setDialogError(`${human.what} ${human.next}`);
    } finally {
      setBusy(false);
    }
  }

  const rows: DisplayRow[] = entries.map((e) => ({ ...e, actions: e.id }));
  const columns: Parameters<typeof DataTable<DisplayRow>>[0]["columns"] = [
    { key: "name", label: t("colName") },
    { key: "voucherType", label: t("colVoucherType") },
    { key: "frequency", label: t("colFrequency") },
    { key: "amountMinor", label: t("colAmount"), cellType: "amount" },
    { key: "nextRunDateDisplay", label: t("colNextRun") },
    { key: "endDateDisplay", label: t("colEndDate") },
    { key: "statusLabel", label: t("colStatus"), cellType: "status" },
  ];
  if (canWrite) {
    columns.push({
      key: "actions",
      label: t("colActions"),
      sortable: false,
      render: (row) => {
        if (row.ended) return null;
        const active = row.statusLabel === "active";
        return (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              type="button"
              aria-label={t(active ? "pauseAria" : "resumeAria", { name: row.name })}
              onClick={() => setPending({ row, action: active ? "pause" : "resume" })}
              style={{ minHeight: 36 }}
            >
              {t(active ? "pause" : "resume")}
            </Button>
            <Button type="button" aria-label={t("endAria", { name: row.name })} onClick={() => setPending({ row, action: "end" })} style={{ minHeight: 36 }}>
              {t("end")}
            </Button>
          </div>
        );
      },
    });
  }

  const titleKey = { pause: "pauseTitle", resume: "resumeTitle", end: "endTitle" } as const;
  const confirmKey = { pause: "pause", resume: "resume", end: "end" } as const;
  const detailKey = { pause: "pauseDetail", resume: "resumeDetail", end: "endDetail" } as const;

  return (
    <>
      {notice ? <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>{notice}</p> : null}
      <Card title={t("cardTitle")}>
        <DataTable<DisplayRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🔁"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(titleKey[pending.action]) : ""}
        confirmLabel={pending ? t(confirmKey[pending.action]) : t("confirm")}
        danger={pending?.action === "end"}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        description={
          pending
            ? t("confirmDescription", {
                name: pending.row.name,
                amount: formatMoney(pending.row.amountMinor),
                frequency: pending.row.frequency,
                nextRun: pending.row.nextRunDateDisplay,
                detail: t(detailKey[pending.action]),
              })
            : ""
        }
        onConfirm={() => { void run(); }}
        onCancel={() => { if (!busy) { setPending(null); setDialogError(undefined); } }}
      />
    </>
  );
}
