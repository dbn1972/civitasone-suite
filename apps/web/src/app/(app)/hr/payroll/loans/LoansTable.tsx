"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, ConfirmDialog } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

export type LoanRow = {
  id: string;
  loanNo: string;
  loanType: string;
  principalMinor: string | number;
  outstandingMinor: string | number;
  emiMinor: string | number;
  tenureMonths: number;
  status: string;
  /** Officer who created the loan (payroll_loans.created_by) -- the maker. */
  createdBy?: string;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-LOANS-04: loan types the create form offers
 * (CreateLoanForm.tsx's <select>) mapped to their display labels. Any other
 * code (loan_type is free-form varchar(32) server-side) falls back to a
 * humanised form of the raw code.
 */
const LOAN_TYPE_KEYS: Record<string, string> = {
  personal: "typePersonal",
  vehicle: "typeVehicle",
  house_building: "typeHouseBuilding",
  festival: "typeFestival",
};

export function humaniseCode(code: string): string {
  const spaced = code.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : code;
}

/** Only an "applied" loan can be disbursed (payroll-service loans/policy.ts DISBURSABLE_LOAN_STATUSES). */
const DISBURSABLE = "applied";

const DISBURSE_REASON_MAX = 500;

export function LoansTable({
  rows,
  canDisburse = false,
  currentUserId = null,
}: {
  rows: LoanRow[];
  /** GAP-PAYROLL-LOANS-02: only payroll admin roles get a Disburse action. */
  canDisburse?: boolean;
  /** Session user id -- the creator of a loan may not disburse it (maker-checker). */
  currentUserId?: string | null;
}) {
  const t = useTranslations("loansTable");
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const pendingLoan = rows.find((r) => r.id === pendingId) ?? null;

  function loanTypeLabel(code: string): string {
    const key = LOAN_TYPE_KEYS[code];
    return key ? t(key) : humaniseCode(code);
  }

  async function disburse(id: string, reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/loans/${id}/disburse`, {
        method: "PATCH",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "SELF_DISBURSE_FORBIDDEN") throw new Error(t("selfDisburseError"));
        if (code === "LOAN_NOT_DISBURSABLE") throw new Error(t("notDisbursableError"));
        throw new Error(await errorMessageFromResponse(res));
      }
      setPendingId(null);
      setMessage(t("disbursedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof LoanRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
    render?: (row: LoanRow) => React.ReactNode;
  }[] = [
    { key: "loanNo", label: t("colLoanNo") },
    { key: "loanType", label: t("colType"), render: (row) => loanTypeLabel(row.loanType) },
    { key: "principalMinor", label: t("colPrincipal"), align: "right", cellType: "amount" },
    { key: "outstandingMinor", label: t("colOutstanding"), align: "right", cellType: "amount" },
    { key: "emiMinor", label: t("colEmi"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  if (canDisburse) {
    columns.push({
      key: "id",
      label: t("colAction"),
      render: (row) => {
        if (row.status !== DISBURSABLE) {
          return <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>;
        }
        if (currentUserId && row.createdBy === currentUserId) {
          // Maker-checker: the server rejects this (403); say why up front
          // instead of offering a button that can only fail.
          return <span style={{ color: "var(--mut)", fontSize: 12 }}>{t("ownLoanNote")}</span>;
        }
        return (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={t("disburseAriaLabel", { loanNo: row.loanNo })}
            onClick={() => {
              setError(undefined);
              setPendingId(row.id);
            }}
          >
            {t("disburseButton")}
          </Button>
        );
      },
    });
  }

  return (
    <div>
      {message && (
        <p role="status" className="pill good" style={{ marginBottom: 10, width: "fit-content" }}>
          {message}
        </p>
      )}
      <DataTable<LoanRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="💳"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      {canDisburse && (
        <ConfirmDialog
          open={!!pendingId}
          title={t("confirmTitle")}
          danger
          requireReason
          reasonLabel={t("reasonLabel")}
          maxReasonLength={DISBURSE_REASON_MAX}
          confirmLabel={t("confirmLabel")}
          busy={busy}
          errorMessage={error}
          description={t.rich("confirmDescription", {
            loanNo: pendingLoan?.loanNo ?? "",
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
          onConfirm={(reason) => pendingId && void disburse(pendingId, reason?.trim() || undefined)}
          onCancel={() => !busy && setPendingId(null)}
        />
      )}
    </div>
  );
}
