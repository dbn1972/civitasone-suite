"use client";

import { useTranslations } from "next-intl";
import { Card, DataTable } from "@/app/_components/ds";
import { formatDrCr, type LedgerBalances } from "./ledgerBalances";

type Row = { id: string; period: string; opening: string; debitMinor: string; creditMinor: string; closing: string };

/**
 * fx-p3: month-by-month Opening / Debit / Credit / Closing for the one head chosen on the ledger page.
 * Opening and closing carry a Dr / Cr suffix from the sign (debit-positive).
 */
export function HeadBalances({ balances }: { balances: LedgerBalances }) {
  const t = useTranslations("financeLedgerBalances");
  const { head } = balances;
  const label = [head.code, head.name].filter(Boolean).join(" · ") || t("unknownHead");
  const rows: Row[] = balances.periods.map((p) => ({
    id: p.period,
    period: p.period,
    opening: formatDrCr(p.openingMinor),
    debitMinor: p.debitMinor,
    creditMinor: p.creditMinor,
    closing: formatDrCr(p.closingMinor),
  }));
  return (
    <Card title={t("title", { head: label, fy: balances.fiscalYear })}>
      <div className="pad" style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          {t("summary", { opening: formatDrCr(balances.openingMinor), closing: formatDrCr(balances.closingMinor) })}
        </p>
        {head.carryForward ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("carryForwardNote")}</p>
        ) : (
          <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("zeroStartNote")}</p>
        )}
      </div>
      <DataTable<Row>
        caption={t("caption", { head: label, fy: balances.fiscalYear })}
        columns={[
          { key: "period", label: t("colMonth") },
          { key: "opening", label: t("colOpening"), align: "right" },
          { key: "debitMinor", label: t("colDebit"), align: "right", cellType: "amount" },
          { key: "creditMinor", label: t("colCredit"), align: "right", cellType: "amount" },
          { key: "closing", label: t("colClosing"), align: "right" },
        ]}
        rows={rows}
        sortable={false}
        pageSize={24}
        emptyIcon="📒"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage", { fy: balances.fiscalYear })}
      />
    </Card>
  );
}

/** Plain GET form (works without JavaScript): choose one head to see its balances for the year. */
export function HeadPicker({ heads, selected, fy }: { heads: Array<{ value: string; label: string }>; selected: string | null; fy: string }) {
  const t = useTranslations("financeLedgerBalances");
  return (
    <form method="get" action="/finance/accounting/general-ledger" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", margin: "0 0 12px" }}>
      <input type="hidden" name="fy" value={fy} />
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span>{t("pickerLabel")}</span>
        <select className="input" name="head" defaultValue={selected ?? ""}>
          <option value="">{t("pickerNone")}</option>
          {heads.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
        </select>
      </label>
      <button type="submit" className="btn ghost">{t("pickerSubmit")}</button>
    </form>
  );
}
