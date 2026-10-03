import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceAdvances } from "../../../../_data/loaders";
import { AdvancesTable } from "./AdvancesTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";
import { advanceStats } from "@/lib/finance/expenditureStats";
import { canWrite, ADVANCE_CREATE_ROLES } from "@/lib/finance/writeRoles";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export default async function AdvancesPage() {
  const t = await getTranslations("expenditureAdvances");
  const result = await getFinanceAdvances();
  const { data: advances, source } = result;

  // A failed load with nothing to show must not read as a clean ledger:
  // the loader falls back to [] so every count would be a genuine-looking 0
  // / ₹0.00 (GAP-FINANCE-EXPENDITURE-ADVANCES-02).
  const failed = result.source === "error" && advances.length === 0;
  const stats = advanceStats(advances);
  // GAP-FINANCE-EXPENDITURE-BILLS-05: POST /v1/finance/advances is FINANCE_ROLES
  // only; do not offer the link to read-only finance readers.
  const mayCreate = canWrite(getSessionRoles(), ADVANCE_CREATE_ROLES);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <PrintExportButton label={t("printExportLabel")} documentTitle={t("printExportDocumentTitle")} />
            {mayCreate ? <a href="/finance/expenditure/advances/new" className="btn primary">{t("newAdvanceLink")}</a> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="💵" iconBg="#e7edfd" label={t("statOpenAdvances")} value={failed ? null : stats.open} />
        <StatCard icon="📤" iconBg="#eff6ff" label={t("statOutstanding")} value={failed ? null : formatMoney(stats.outstanding)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statSettledAllTime")} value={failed ? null : formatMoney(stats.settledAllTime)} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label={t("statOverdue")} value={failed ? null : stats.overdue90} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside AdvancesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaAdvances")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          <AdvancesTable advances={advances} source={source} />
        </Card>
      )}
    </>
  );
}
