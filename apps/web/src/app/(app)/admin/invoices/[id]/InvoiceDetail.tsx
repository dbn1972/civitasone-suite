"use client";
import { useTranslations } from "next-intl";
import { Button, Card, DataTable, EmptyState, LoadErrorState, PageHeader, StatCard, StatGrid, StatusPill } from "@/app/_components/ds";
import type { AdminInvoiceApproval, AdminInvoiceDetail, AdminInvoiceItem } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { invoiceStatusTone } from "../invoiceStats";
import { InvoiceOpsPanel, type InvoiceOpsData } from "./InvoiceOpsPanel";

export type InvoiceDetailState =
  | { kind: "ready"; invoice: AdminInvoiceDetail; ops?: InvoiceOpsData }
  | { kind: "not-found" }
  | { kind: "error"; status?: number };

type ItemRow = AdminInvoiceItem & Record<string, unknown>;
type ApprovalRow = AdminInvoiceApproval & Record<string, unknown>;

/** One invoice: summary, line items, approval history. Distinct states for ready / not found / failed to load. */
export function InvoiceDetail({ state }: { state: InvoiceDetailState }) {
  const t = useTranslations("adminInvoiceDetail");
  if (state.kind === "not-found") {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/admin/invoices" />
        <Card>
          <EmptyState icon="🧾" title={t("notFoundTitle")} message={t("notFoundMessage")} />
        </Card>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/admin/invoices" />
        <LoadErrorState result={{ status: state.status }} area={t("area")} backHref="/admin/invoices" />
      </div>
    );
  }
  const inv = state.invoice;
  const money = (v: string) => formatMoney(v);
  return (
    <div className="page-main wrap">
      <PageHeader title={t("heading", { period: inv.periodMonth })} subtitle={t("subtitle")} back="/admin/invoices" />
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }} className="no-print">
        <StatusPill status={inv.status} variant={invoiceStatusTone(inv.status)} />
        <Button type="button" variant="ghost" size="sm" onClick={() => window.print()}>{t("print")}</Button>
      </div>
      <StatGrid>
        <StatCard icon="🧾" iconBg="#eef2ff" label={t("total")} value={money(inv.totalMinor)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("paid")} value={money(inv.paidMinor)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={t("outstanding")} value={money(inv.outstandingMinor)} />
        <StatCard icon="🧮" iconBg="#f1f5f9" label={t("tax")} value={money(inv.taxMinor)} />
      </StatGrid>
      <Card title={t("details")}>
        <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "8px 16px", margin: 0, fontSize: 13.5 }}>
          <dt style={{ color: "var(--mut)" }}>{t("invoiceId")}</dt><dd style={{ margin: 0 }}><code>{inv.id}</code></dd>
          <dt style={{ color: "var(--mut)" }}>{t("period")}</dt><dd style={{ margin: 0 }}>{inv.periodMonth}</dd>
          <dt style={{ color: "var(--mut)" }}>{t("charges")}</dt><dd style={{ margin: 0 }}>{money(inv.chargesMinor)}</dd>
          <dt style={{ color: "var(--mut)" }}>{t("issued")}</dt><dd style={{ margin: 0 }}>{inv.issuedAt ? formatIndianDate(inv.issuedAt) : "—"}</dd>
          <dt style={{ color: "var(--mut)" }}>{t("paidOn")}</dt><dd style={{ margin: 0 }}>{inv.paidAt ? formatIndianDate(inv.paidAt) : "—"}</dd>
          {inv.cancelledAt && (<><dt style={{ color: "var(--mut)" }}>{t("cancelled")}</dt><dd style={{ margin: 0 }}>{formatIndianDate(inv.cancelledAt)}{inv.cancelReason ? ` — ${inv.cancelReason}` : ""}</dd></>)}
        </dl>
      </Card>
      {state.ops && <InvoiceOpsPanel invoice={inv} initial={state.ops} />}
      <Card title={t("items")}>
        <DataTable<ItemRow>
          columns={[
            { key: "description", label: t("colDescription") },
            { key: "kind", label: t("colKind"), render: (r) => String(r.kind) },
            { key: "quantity", label: t("colQuantity"), align: "right" },
            { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
          ]}
          rows={inv.items as ItemRow[]} pageSize={50} emptyIcon="🧾" emptyTitle={t("noItemsTitle")} emptyMessage={t("noItemsMessage")}
        />
      </Card>
      <Card title={t("approvals")}>
        <DataTable<ApprovalRow>
          columns={[
            { key: "action", label: t("colAction") },
            { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={String(r.status)} /> },
            { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
            { key: "decidedAt", label: t("colDecided"), cellType: "date" },
            { key: "reason", label: t("colReason"), render: (r) => (r.reason ? String(r.reason) : "—") },
          ]}
          rows={inv.approvals as ApprovalRow[]} pageSize={50} emptyIcon="📝" emptyTitle={t("noApprovalsTitle")} emptyMessage={t("noApprovalsMessage")}
        />
      </Card>
    </div>
  );
}
