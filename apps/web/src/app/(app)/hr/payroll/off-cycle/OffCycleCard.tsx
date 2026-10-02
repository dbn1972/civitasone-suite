"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, StatusPill, ConfirmDialog } from "../../../../_components/ds";
import { postWithErrorCode } from "../_lib/postWithErrorCode";
import { formatMoney } from "@/lib/formatters";
import type { OffCycleRow } from "./types";

/** GAP-PAYROLL-OFF-CYCLE-04: minimum length of the mandatory processing reason. */
export const PROCESS_REASON_MIN = 10;

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

// UX-017: this map's keys are the stable backend run_type/reason codes
// ("bonus", "incentive", ...) -- never translated, only used to look up
// which message key holds the display text. Same safe pattern as this
// gap's earlier "STATUS_CHIP-style label lookup object" precedent
// (hr/leave, tranche 2): translating the VALUES is fine; the KEYS must stay
// untouched literals since `row.run_type` (the wire value) is compared
// against them directly.
const REASON_LABEL_KEYS: Record<string, string> = {
  bonus: "reasonBonus",
  incentive: "reasonIncentive",
  arrear: "reasonArrear",
  adhoc: "reasonAdhoc",
  correction: "reasonCorrection",
};

function reasonLabelFor(t: Translator, runType: string): string {
  const key = REASON_LABEL_KEYS[runType];
  return key ? t(key) : runType.replace(/_/g, " ");
}

function RunCard({ row, onProcess, canProcess }: { row: OffCycleRow; onProcess: (row: OffCycleRow) => void; canProcess: boolean }) {
  const t = useTranslations("offCycleCard");
  const reasonLabel = reasonLabelFor(t, row.run_type);
  const totalAmount = BigInt(String(row.total_amount_minor ?? 0));
  const netAmount = BigInt(String(row.total_net_minor ?? 0));
  // GAP-PAYROLL-OFF-CYCLE-02: now actually returned by GET /off-cycle.
  const empCount = typeof row.employee_count === "number" ? row.employee_count : null;

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "var(--panel)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{reasonLabel}</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
            {t("periodLabel")}
            <strong>{row.period}</strong>
            {row.description ? " · " + row.description : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status={row.status} />
          {row.status === "draft" && canProcess && (
            <Button
              type="button"
              variant="primary"
              style={{ minHeight: 32, fontSize: 12, padding: "0 14px" }}
              onClick={() => onProcess(row)}
              aria-label={t("processRunAriaLabel", { reason: reasonLabel, period: row.period })}
            >
              {t("processRunBtn")}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("statTotalAmount")}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{formatMoney(totalAmount)}</div>
        </div>
        {netAmount > 0n && (
          <div>
            <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("statNetPayable")}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{formatMoney(netAmount)}</div>
          </div>
        )}
        {empCount !== null && (
          <div>
            <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("statEmployeesInScope")}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{empCount}</div>
          </div>
        )}
      </div>
      {/* GAP-PAYROLL-OFF-CYCLE-01: there is no separate approval_status on an
          off-cycle run (payroll.off_cycle_runs has only `status`); the card
          used to show a second "Approval Status" pill that just echoed
          `status`, implying an approval step that did not exist. The real
          control is server-side: processing is the checker step and must be
          done by someone other than the run's creator. Say so. */}
      {row.status === "draft" && (
        <p style={{ margin: 0, padding: "0 18px 12px", fontSize: 12, color: "var(--ink2)" }}>{t("checkerNote")}</p>
      )}
      {/* GAP-PAYROLL-OFF-CYCLE-05: processing an off-cycle run only computes
          tax and net payable (offCycleProcess consumer); it creates no bank
          transfer, so say what the next step is instead of implying payment. */}
      {row.status !== "draft" && (
        <p style={{ margin: 0, padding: "0 18px 12px", fontSize: 12, color: "var(--ink2)" }}>{t("processedNextStepNote")}</p>
      )}
    </div>
  );
}

export function OffCycleCards({ rows, canProcess = false }: { rows: OffCycleRow[]; canProcess?: boolean }) {
  const t = useTranslations("offCycleCard");
  const router = useRouter();
  const [pendingRow, setPendingRow] = useState<OffCycleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function processRun(reason?: string) {
    if (!pendingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      // GAP-PAYROLL-OFF-CYCLE-04: the mandatory reason goes to the audit
      // record. The endpoint is async (202 + {id,status,correlationId}); tax
      // and net are computed by the worker, so nothing is read back.
      await postWithErrorCode("v1/payroll/off-cycle/" + pendingRow.id + "/process", { reason: reason?.trim() }, {
        SELF_APPROVAL_FORBIDDEN: t("selfProcessError"),
        OFF_CYCLE_NOT_DRAFT: t("notDraftError"),
      });
      setMessage(t("processSubmittedMessage", { period: pendingRow.period }));
      setPendingRow(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🗂️</p>
        <p style={{ fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ fontSize: 13 }}>{t("emptyMessage")}</p>
      </div>
    );
  }

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <div style={{ display: "grid", gap: 14 }}>
        {rows.map((row) => (
          <RunCard key={row.id} row={row} canProcess={canProcess} onProcess={(r) => { setDialogError(undefined); setPendingRow(r); }} />
        ))}
      </div>

      <ConfirmDialog
        open={pendingRow !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={PROCESS_REASON_MIN}
        maxReasonLength={512}
        description={
          pendingRow ? (
            t.rich("confirmDescription", {
              reason: reasonLabelFor(t, pendingRow.run_type),
              period: pendingRow.period,
              amount: formatMoney(pendingRow.total_amount_minor),
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          ) : null
        }
        onConfirm={(reason) => void processRun(reason)}
        onCancel={() => !busy && setPendingRow(null)}
      />
    </>
  );
}
