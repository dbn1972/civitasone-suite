import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceUCs } from "../../../../_data/loaders";
import { UCsTable } from "./UCsTable";
import { formatMoney } from "@/lib/formatters";

export default async function UCsPage() {
  const t = await getTranslations("expenditureUtilizationCertificates");
  const { data: ucs, source } = await getFinanceUCs();

  const submitted = ucs.filter((u) => u.status === "submitted" || u.status === "verified").length;
  const pending = ucs.filter((u) => u.status === "pending" || u.status === "rejected").length;
  // uc.amount is a bigint-safe minor-unit STRING (see packages/types'
  // UCSummary) -- summing with `+` would string-concatenate instead of
  // adding, so accumulate in BigInt (formatMoney already accepts bigint).
  const totalAmount = ucs.reduce((s, u) => s + BigInt(u.amount), 0n);

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
        <StatCard icon="📋" iconBg="#e7edfd" label={t("statTotal")} value={ucs.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statSubmittedVerified")} value={submitted} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={t("statPendingSubmission")} value={pending} />
        <StatCard icon="💰" iconBg="#eff6ff" label={t("statCoveredAmount")} value={formatMoney(totalAmount)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside UCsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title={t("cardTitle")}>
        <UCsTable ucs={ucs} source={source} />
      </Card>
    </>
  );
}
