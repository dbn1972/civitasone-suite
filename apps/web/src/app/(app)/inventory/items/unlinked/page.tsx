import { getTranslations } from "next-intl/server";
import { EmptyState, LoadErrorState, PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { INVENTORY_ITEM_LINK_ROLES, getSessionRoles } from "@/lib/auth/roleGuard";
import { getLinkSuggestions, getUnmatchedReport } from "../../_dataLinks";
import { UnmatchedReportClient } from "./UnmatchedReportClient";

export const dynamic = "force-dynamic";

/**
 * Admin report of items that exist in only one of the two item masters, plus the exact
 * code/sku matches an admin can confirm (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02).
 * Reports only: no item or stock record is merged, renamed or re-identified.
 */
export default async function UnlinkedItemsPage() {
  const t = await getTranslations("inventoryLink");
  const allowed = getSessionRoles().some((r) => INVENTORY_ITEM_LINK_ROLES.includes(r));
  if (!allowed) {
    return (
      <>
        <PageHeader title={t("report.title")} back="/inventory/items" />
        <EmptyState icon="🔒" title={t("report.title")} message={t("report.notAllowed")} />
      </>
    );
  }
  const [reportRes, sugRes] = await Promise.all([getUnmatchedReport(), getLinkSuggestions()]);
  const report = reportRes.data;
  if (reportRes.source === "error" || report === null) {
    return (
      <>
        <PageHeader title={t("report.title")} back="/inventory/items" />
        <LoadErrorState result={reportRes} area={t("report.loadFailed")} backHref="/inventory/items" />
      </>
    );
  }
  const suggestionsFailed = sugRes.source === "error";
  const c = report.counts;
  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN"));
  return (
    <>
      <PageHeader title={t("report.title")} subtitle={t("report.subtitle")} back="/inventory/items" backLabel={t("report.back")} />
      <StatGrid>
        <StatCard icon="📦" iconBg="#f1f5f9" label={t("report.inventoryTotal")} value={num(c.inventoryTotal)} />
        <StatCard icon="🔗" iconBg="#fef3c7" label={t("report.inventoryUnlinked")} value={num(c.inventoryUnlinked)} />
        <StatCard icon="🏬" iconBg="#eff6ff" label={t("report.stockUnlinked")} value={num(c.stockUnlinked)} />
        <StatCard icon="✅" iconBg="#dcfce7" label={t("report.suggestions")} value={num(c.suggestions)} />
        <StatCard icon="🔍" iconBg="#fee2e2" label={t("report.ambiguous")} value={num(c.ambiguous)} />
      </StatGrid>
      <UnmatchedReportClient
        report={report}
        suggestions={suggestionsFailed ? null : sugRes.data.rows}
      />
    </>
  );
}
