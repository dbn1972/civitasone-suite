import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceBills } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { BillCreateAction } from "../../_components/FinanceActions";
import { BillsTable } from "./BillsTable";
import Link from "next/link";

export default async function BillsPage() {
  const t = await getTranslations("expenditureBills");
  const { data: bills, source } = await getFinanceBills();

  const inProcess = bills.filter((b) => b.status === "pending" || b.status === "under_review").length;
  const paid = bills.filter((b) => b.status === "paid").length;
  // bill.amount is a bigint-safe minor-unit STRING (see packages/types'
  // BillSummary) -- summing with `+` would string-concatenate instead of
  // adding, so accumulate in BigInt (formatMoney already accepts bigint).
  const totalAmount = bills.reduce((s, b) => s + BigInt(b.amount), 0n);
  const paidAmount = bills.filter((b) => b.status === "paid").reduce((s, b) => s + BigInt(b.amount), 0n);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {/* /finance/config sets up FYs/banks, not pre-audit rules — there is no
                dedicated pre-audit-rules screen yet, so this points to the closest
                real destination rather than promising content that doesn't exist. */}
            <Link href="/finance/config" className="btn ghost">{t("financeConfigLink")}</Link>
            <BillCreateAction />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🧮" iconBg="#e7edfd" label={t("statInProcess")} value={inProcess} />
        <StatCard icon="⏱" iconBg="#fffaeb" label={t("statTotal")} value={bills.length} />
        <StatCard icon="💸" iconBg="#eff6ff" label={t("statValueInPipeline")} value={formatMoney(totalAmount)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statPaidMtd")} value={formatMoney(paidAmount)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside BillsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title={t("cardTitle")}>
        <BillsTable bills={bills} source={source} />
      </Card>
    </>
  );
}
