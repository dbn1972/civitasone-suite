"use client";

/**
 * GAP-FINANCE-CONFIG-02: the bank-account list shows the server-masked number
 * (last four). A finance administrator who needs the full number asks for it
 * with a stated reason; finance-service records actor + reason in the audit
 * trail BEFORE returning a digit, and the number is shown only briefly. The CSV
 * export stays off for this table.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, DataTable } from "@/app/_components/ds";
import { maskLast4 } from "@/app/_components/ds/Masked";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type BankAccountRow = {
  id: string;
  bankName: string;
  branchName?: string | null;
  accountNoLast4?: string | null;
  ifscPrefix?: string | null;
  accountType?: string | null;
  purpose?: string | null;
  status?: string | null;
};

/** Revealed numbers hide themselves after this long. */
export const REVEAL_VISIBLE_MS = 30_000;

function AccountNumberCell({ row, canReveal }: { row: BankAccountRow; canReveal: boolean }) {
  const t = useTranslations("financeBankReveal");
  const [full, setFull] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function reveal(reason?: string) {
    const res = await browserFetch(`v1/finance/bank-accounts/${encodeURIComponent(row.id)}/reveal`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res, "load", t("area")));
    const body = (await res.json()) as { accountNo?: string };
    if (typeof body.accountNo !== "string") throw new Error(t("failed"));
    setFull(body.accountNo);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFull(null), REVEAL_VISIBLE_MS);
  }

  if (full !== null) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span className="mono" data-testid="revealed-account">{full}</span>
        <button type="button" className="btn ghost" onClick={() => setFull(null)}>{t("hide")}</button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="mono">{maskLast4(String(row.accountNoLast4 ?? ""))}</span>
      {canReveal ? (
        <ActionButton
          label={t("reveal")}
          className="btn ghost"
          confirmTitle={t("title")}
          confirmDescription={t("description")}
          confirmLabel={t("confirm")}
          requireReason
          reasonLabel={t("reasonLabel")}
          minReasonLength={10}
          maxReasonLength={500}
          onConfirm={reveal}
        />
      ) : null}
    </span>
  );
}

export function BankAccountsTable({ rows, canReveal }: { rows: BankAccountRow[]; canReveal: boolean }) {
  const t = useTranslations("financeBankReveal");
  return (
    <DataTable<BankAccountRow & { accountNo: string }>
      columns={[
        { key: "bankName", label: t("colBank") },
        { key: "branchName", label: t("colBranch") },
        { key: "accountNo", label: t("colAccount"), render: (r) => <AccountNumberCell row={r} canReveal={canReveal} /> },
        { key: "ifscPrefix", label: t("colIfsc") },
        { key: "accountType", label: t("colType") },
        { key: "status", label: t("colStatus"), cellType: "status" },
      ]}
      rows={rows.map((r) => ({ ...r, accountNo: r.id }))}
      sortable
      emptyIcon="🏦"
      emptyTitle={t("emptyTitle")}
      emptyMessage={t("emptyMessage")}
    />
  );
}
