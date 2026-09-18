import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceAdvances } from "../../../../_data/loaders";
import { AdvancesTable } from "./AdvancesTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { formatMoney } from "@/lib/formatters";

export default async function AdvancesPage() {
  const t = await getTranslations("expenditureAdvances");
  const { data: advances, source } = await getFinanceAdvances();

  const openAdvances = advances.filter((a) => a.status === "active").length;
  const overdue = advances.filter((a) => a.status === "overdue").length;
  // balance/adjustedAmount are bigint-safe minor-unit STRINGs (see
  // packages/types' AdvanceSummary) -- summing with `+` would
  // string-concatenate, so accumulate in BigInt (formatMoney accepts bigint).
  const totalBalance = advances.reduce((s, a) => s + BigInt(a.balance), 0n);
  const settled = advances.filter((a) => a.status === "adjusted").reduce((s, a) => s + BigInt(a.adjustedAmount), 0n);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <PrintExportButton label={t("printExportLabel")} documentTitle={t("printExportDocumentTitle")} />
            <a href="/finance/expenditure/advances/new" className="btn primary">{t("newAdvanceLink")}</a>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="💵" iconBg="#e7edfd" label={t("statOpenAdvances")} value={openAdvances} />
        <StatCard icon="📤" iconBg="#eff6ff" label={t("statOutstanding")} value={formatMoney(totalBalance)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statSettledMtd")} value={formatMoney(settled)} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label={t("statOverdue")} value={overdue} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside AdvancesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title={t("cardTitle")}>
        <AdvancesTable advances={advances} source={source} />
      </Card>
    </>
  );
}
