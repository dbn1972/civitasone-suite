import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceSchemeById } from "@/app/_data/loaders";
import { ucRegisterHref } from "../../utilization-certificates/ucScheme";
import { formatIndianDate, formatMoney, humanizeStatus, utilisationPercent, isOverUtilised } from "@/lib/formatters";

/**
 * Scheme detail, wired to GET /v1/finance/schemes/:id (finance-service budget
 * routes). The fabricated milestone / fund-release tables were dropped -- the
 * real scheme record carries no such fields. A failed load (5xx / 403 /
 * network) is shown as an error state, never as "not available".
 */
export default async function SchemeDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("expenditureSchemeDetail");
  const result = await getFinanceSchemeById(params.id);
  const { data: scheme } = result;

  if (!scheme) {
    if (result.source === "error" && result.status !== 404) {
      return (
        <div className="page-main wrap">
          <PageHeader title={t("titleNotFound")} back="/finance/expenditure/scheme-tracking" />
          <LoadErrorState result={result} area="scheme" backHref="/finance/expenditure/scheme-tracking" />
        </div>
      );
    }
    return (
      <div className="page-main wrap">
        <PageHeader title={t("titleNotFound")} back="/finance/expenditure/scheme-tracking" />
        <EmptyState
          icon="🎯"
          title={t("emptyTitleNotAvailable")}
          message={t("emptyMessageNotAvailable")}
        />
      </div>
    );
  }

  // BigInt-safe; null (no positive outlay) renders "—", never a fabricated 0%.
  const utilisationPct = utilisationPercent(scheme.utilisedMinor, scheme.outlayMinor);
  // Flag on the exact comparison, not the rounded percentage (100.3% must flag).
  const overUtilised = isOverUtilised(scheme.utilisedMinor, scheme.outlayMinor);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={scheme.name}
        subtitle={scheme.funding ?? scheme.code}
        back="/finance/expenditure/scheme-tracking"
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label={t("outlay")} value={formatMoney(scheme.outlayMinor)} />
        <StatCard icon="📤" iconBg="#e7edfd" label={t("utilised")} value={formatMoney(scheme.utilisedMinor)} />
        <StatCard icon="📊" iconBg="#fffaeb" label={t("statUtilisation")} value={utilisationPct === null ? "—" : overUtilised ? `${utilisationPct}% · ${t("overUtilised")}` : `${utilisationPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("status")} value={humanizeStatus(scheme.status)} />
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

      {/* GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05: links only to routes that exist. */}
      <Card title={t("relatedTitle")} padding>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><Link href={ucRegisterHref(scheme.name)}>{t("relatedUcs")}</Link></li>
          <li><Link href="/finance/budget/fund-releases">{t("relatedFundReleases")}</Link></li>
        </ul>
      </Card>
    </div>
  );
}
