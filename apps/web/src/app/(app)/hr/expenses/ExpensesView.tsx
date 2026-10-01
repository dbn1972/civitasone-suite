"use client";

/**
 * GAP-HR-EXPENSES-02/03: an approver previously had no way to reach a
 * pending claim from the UI at all. For a session with an approver role
 * (manager/hr_admin/finance_officer/super_admin -- see page.tsx's
 * EXPENSE_DECIDE_ROLES, matching the backend's own role list exactly) this
 * adds an "Approvals" tab alongside "My Claims"; everyone else sees only
 * their own claims table, unchanged from before this tab existed.
 *
 * This owns the tab-switch UI state (needs client-side interactivity), but
 * both row sets are fetched server-side in page.tsx and passed in as plain
 * data -- avoiding a second client-side fetch/waterfall when an approver
 * switches tabs.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "../../../_components/ds";
import { ExpensesTable } from "./ExpensesTable";
import type { Row } from "./mapExpenses";

export function ExpensesView({
  myRows,
  approvalRows,
  canDecide,
}: {
  myRows: Row[];
  approvalRows: Row[];
  canDecide: boolean;
}) {
  const t = useTranslations("expenses");
  const tabMine = t("tabMine");
  const tabApprovals = t("tabApprovals");
  const [tab, setTab] = useState(tabMine);

  const labels = {
    employee: t("colEmployee"),
    category: t("colCategory"),
    amount: t("colAmount"),
    description: t("colDescription"),
    date: t("colClaimDate"),
    status: t("colStatus"),
    receipt: t("colReceipt"),
    actions: t("colActions"),
  };

  if (!canDecide) {
    return (
      <ExpensesTable
        rows={myRows}
        mode="mine"
        filterPlaceholder={t("filterPlaceholder")}
        emptyIcon="🧾"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        labels={labels}
      />
    );
  }

  return (
    <div>
      <Tabs tabs={[tabMine, tabApprovals]} active={tab} onChange={setTab} />
      <div style={{ marginTop: 12 }}>
        {tab === tabApprovals ? (
          <ExpensesTable
            rows={approvalRows}
            mode="approvals"
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="✅"
            emptyTitle={t("emptyApprovalsTitle")}
            emptyMessage={t("emptyApprovalsMessage")}
            labels={labels}
          />
        ) : (
          <ExpensesTable
            rows={myRows}
            mode="mine"
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="🧾"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
            labels={labels}
          />
        )}
      </div>
    </div>
  );
}
