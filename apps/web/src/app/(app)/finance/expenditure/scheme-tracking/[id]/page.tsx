import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceSchemeById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

/**
 * Scheme detail, wired to GET /v1/finance/schemes/:id (finance-service budget
 * routes). The fabricated milestone / fund-release tables were dropped -- the
 * real scheme record carries no such fields. A failed load (5xx / 403 /
 * network) is shown as an error state, never as "not available".
 */
export default async function SchemeDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("expenditureSchemeDetail");
  const result = await getFinanceSchemeById(params.id);
  const { data: scheme, source } = result;

  if (!scheme) {
    if (result.source === "error" && result.status !== 404) {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title={t("titleNotFound")} back="/finance/expenditure/scheme-tracking" />
          <LoadErrorState result={result} area="scheme" backHref="/finance/expenditure/scheme-tracking" />
        </div>
      );
    }
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("titleNotFound")} back="/finance/expenditure/scheme-tracking" />
        <EmptyState
          icon="🎯"
          title={t("emptyTitleNotAvailable")}
          message={t("emptyMessageNotAvailable")}
        />
      </div>
    );
  }

  const outlay = Number(scheme.outlayMinor);
  const utilised = Number(scheme.utilisedMinor);
  const utilisationPct = outlay > 0 ? Math.round((utilised / outlay) * 100) : 0;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={scheme.name}
        subtitle={scheme.funding ?? scheme.code}
        back="/finance/expenditure/scheme-tracking"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label={t("outlay")} value={formatMoney(scheme.outlayMinor)} />
        <StatCard icon="📤" iconBg="#e7edfd" label={t("utilised")} value={formatMoney(scheme.utilisedMinor)} />
        <StatCard icon="📊" iconBg="#fffaeb" label={t("statUtilisation")} value={`${utilisationPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("status")} value={scheme.status} />
      </StatGrid>

      <Card title={t("cardTitle")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldCode")}</span><span className="mono">{scheme.code}</span></div>
          <div className="field"><span className="label">{t("fieldName")}</span><span>{scheme.name}</span></div>
          <div className="field"><span className="label">{t("fieldFunding")}</span><span>{scheme.funding ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldCurrency")}</span><span>{scheme.currency}</span></div>
          <div className="field"><span className="label">{t("outlay")}</span><span>{formatMoney(scheme.outlayMinor)}</span></div>
          <div className="field"><span className="label">{t("utilised")}</span><span>{formatMoney(scheme.utilisedMinor)}</span></div>
          <div className="field"><span className="label">{t("fieldCreated")}</span><span>{formatIndianDate(scheme.createdAt)}</span></div>
          <div className="field"><span className="label">{t("fieldLastUpdated")}</span><span>{formatIndianDate(scheme.updatedAt)}</span></div>
          <div className="field"><span className="label">{t("status")}</span><StatusPill status={scheme.status} /></div>
        </div>
      </Card>
    </div>
  );
}
