"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FinanceDebtEmi } from "@civitasone/types";
import { ActionButton, DataTable } from "@/app/_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

type Row = FinanceDebtEmi & { action: string };

/** Index of the first instalment still due (the natural next one to record), or -1. */
export function nextDueIndex(schedule: readonly Pick<FinanceDebtEmi, "status">[]): number {
  return schedule.findIndex((e) => e.status === "due");
}

export function DebtSchedule({ debtId, schedule, canRecordPayment }: { debtId: string; schedule: FinanceDebtEmi[]; canRecordPayment: boolean }) {
  const t = useTranslations("financeDebtDetail");
  const router = useRouter();

  async function pay(no: number, ref?: string) {
    const res = await browserFetch(`v1/finance/debt/${encodeURIComponent(debtId)}/emi/${no}/pay`, {
      method: "POST",
      body: JSON.stringify(ref ? { paymentRef: ref } : {}),
    });
    if (res.ok) return;
    const code = await errorCodeFromResponse(res);
    if (code === "EMI_ALREADY_PAID") throw new Error(t("alreadyPaid"));
    if (code === "EMI_OUT_OF_ORDER") throw new Error(t("outOfOrder"));
    if (code === "GL_HEADS_NOT_CONFIGURED") throw new Error(t("glNotConfigured"));
    if (code === "EMI_PAID_ON_FUTURE" || code === "EMI_PAID_ON_BEFORE_LOAN") throw new Error(t("badPaidOn"));
    throw new Error(await errorMessageFromResponse(res, "save", t("area")));
  }

  const next = nextDueIndex(schedule);
  return (
    <DataTable<Row>
      columns={[
        { key: "installmentNo", label: t("colNo") },
        { key: "dueDate", label: t("colDue"), render: (e) => formatIndianDate(e.dueDate) },
        { key: "principalMinor", label: t("colPrincipal"), align: "right", render: (e) => formatMoney(e.principalMinor) },
        { key: "interestMinor", label: t("colInterest"), align: "right", render: (e) => formatMoney(e.interestMinor) },
        { key: "totalMinor", label: t("colTotal"), align: "right", render: (e) => formatMoney(e.totalMinor) },
        { key: "status", label: t("colStatus"), render: (e) => (e.status === "paid" ? <span className="pill good">{t("paid")}</span> : <span className="pill warn">{t("due")}</span>) },
        {
          key: "glStatus",
          label: t("colGl"),
          // Posting status of the instalment's journal; a due instalment has none yet.
          render: (e) => (e.glStatus === "posted" ? <span className="pill good">{t("glPosted")}</span> : e.glStatus === "pending" ? <span className="pill warn">{t("glPending")}</span> : "—"),
        },
        { key: "paidOn", label: t("colPaidOn"), render: (e) => (e.paidOn ? `${formatIndianDate(e.paidOn)}${e.paymentRef ? ` · ${e.paymentRef}` : ""}` : "—") },
        {
          key: "action",
          label: t("colAction"),
          render: (e) =>
            // Instalments are recorded in order: only the first one still due offers the button.
            e.status === "due" && canRecordPayment && schedule[next]?.installmentNo === e.installmentNo ? (
              <ActionButton
                label={t("markPaid")}
                className="btn ghost"
                confirmTitle={t("markPaidTitle", { no: e.installmentNo })}
                confirmDescription={t("markPaidHelp", { amount: formatMoney(e.totalMinor) })}
                confirmLabel={t("markPaid")}
                optionalReason
                reasonLabel={t("paymentRef")}
                maxReasonLength={128}
                onConfirm={(ref) => pay(e.installmentNo, ref)}
                onSuccess={() => router.refresh()}
              />
            ) : "—",
        },
      ]}
      rows={schedule.map((e) => ({ ...e, action: String(e.installmentNo) }))}
      pageSize={24}
      emptyIcon="🗓️"
      emptyTitle={t("noScheduleTitle")}
      emptyMessage={t("noScheduleMessage")}
      identifyingColumnKey="installmentNo"
    />
  );
}
