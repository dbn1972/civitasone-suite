"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, StatusPill, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { OffCycleRow } from "./OffCycleList";

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

function RunCard({ row, onProcess }: { row: OffCycleRow; onProcess: (row: OffCycleRow) => void }) {
  const t = useTranslations("offCycleCard");
  const reasonLabel = reasonLabelFor(t, row.run_type);
  const totalAmount = Number(row.total_amount_minor ?? 0);
  const netAmount = Number(row.total_net_minor ?? 0);
  const empCount = (row.employee_count as number | undefined) ?? null;
  const approvalStatus = (row.approval_status as string | undefined) ?? row.status;

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
          {row.status === "draft" && (
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
        {netAmount > 0 && (
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
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("statApprovalStatus")}</div>
          <div style={{ marginTop: 5 }}><StatusPill status={approvalStatus} /></div>
        </div>
      </div>
    </div>
  );
}

export function OffCycleCards({ rows }: { rows: OffCycleRow[] }) {
  const t = useTranslations("offCycleCard");
  const router = useRouter();
  const [pendingRow, setPendingRow] = useState<OffCycleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function processRun() {
    if (!pendingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data: { id: string; totalNetMinor: number } }>(
        "v1/payroll/off-cycle/" + pendingRow.id + "/process",
        { method: "POST" },
      );
      setMessage(t("processedMessage", { period: pendingRow.period, amount: formatMoney(res.data.totalNetMinor) }));
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
          <RunCard key={row.id} row={row} onProcess={(r) => { setDialogError(undefined); setPendingRow(r); }} />
        ))}
      </div>

      <ConfirmDialog
        open={pendingRow !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
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
        onConfirm={() => void processRun()}
        onCancel={() => !busy && setPendingRow(null)}
      />
    </>
  );
}
