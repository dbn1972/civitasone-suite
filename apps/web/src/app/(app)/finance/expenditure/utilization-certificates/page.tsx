import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceUCs, getFinanceSchemes } from "../../../../_data/loaders";
import { UCsTable } from "./UCsTable";
import { ucMatchesScheme, resolveSchemeRef } from "./ucScheme";
import { formatMoney } from "@/lib/formatters";
import { ucStats } from "@/lib/finance/expenditureStats";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";

export default async function UCsPage({ searchParams }: { searchParams?: { scheme?: string } }) {
  const t = await getTranslations("expenditureUtilizationCertificates");
  // GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05: ?scheme= carries a Scheme Tracking code; the schemes are read only
  // when the register is being narrowed, to turn the code into the scheme's name (for the note and for older certificates).
  const schemeParam = searchParams?.scheme?.trim() || undefined;
  const [result, schemesResult] = await Promise.all([getFinanceUCs(), schemeParam ? getFinanceSchemes() : Promise.resolve(null)]);
  const { data: ucs, source } = result;

  // Failed load with nothing to show must not read as zero UCs / ₹0.00
  // (GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-02).
  const failed = result.source === "error" && ucs.length === 0;
  // ?scheme= narrows the register to one scheme (linked from the scheme detail page); the stats and the table both follow it.
  const scheme = schemeParam
    ? resolveSchemeRef(schemeParam, schemesResult && schemesResult.source !== "error" ? schemesResult.data : null)
    : undefined;
  const shown = scheme ? ucs.filter((u) => ucMatchesScheme(u, scheme)) : ucs;
  const stats = ucStats(shown);
  const roles = getSessionRoles();
  // finance-service: verify/return = finance_admin/super_admin; resubmit = finance staff.
  const canVerify = roles.some((r) => ["finance_admin", "super_admin"].includes(r));
  const canResubmit = roles.some((r) => ["finance_officer", "finance_admin", "super_admin"].includes(r));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {/* A "Download Format" action used to link here too, identical to
                "+ New UC" — there's no UC template file to download, so the
                dead duplicate button was removed rather than left misleading. */}
            <a href="/finance/expenditure/utilization-certificates/new" className="btn primary">{t("newUcLink")}</a>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" tone="info" label={t("statTotal")} value={failed ? null : stats.total} />
        <StatCard icon="✅" tone="good" label={t("statSubmittedVerified")} value={failed ? null : stats.submittedVerified} />
        <StatCard icon="⏳" tone="warn" label={t("statPendingSubmission")} value={failed ? null : stats.pending} />
        <StatCard icon="↩️" tone="bad" label={t("statRejected")} value={failed ? null : stats.rejected} />
        <StatCard icon="💰" tone="info" label={t("statCoveredAmount")} value={failed ? null : formatMoney(stats.covered)} />
        <StatCard icon="🕒" tone="warn" label={t("statPendingAmount")} value={failed ? null : formatMoney(stats.pendingAmount)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside UCsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaUcs")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          {scheme ? (
            <p style={{ padding: "8px 16px", fontSize: 13 }}>
              {t("schemeFilterNote", { scheme: scheme.name || scheme.code })} <a href="/finance/expenditure/utilization-certificates">{t("schemeFilterClear")}</a>
            </p>
          ) : null}
          <UCsTable ucs={ucs} source={source} scheme={scheme} viewerId={getSessionUserId()} canVerify={canVerify} canResubmit={canResubmit} />
        </Card>
      )}
    </>
  );
}
