import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getFinanceCommitments, getFinanceBudgetMonitoringLines } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { formatMoneyCompact } from "@/lib/formatters";
import { FyFilter } from "../../_components/FyFilter";
import { CommitmentsTable, COMMITMENT_FETCH_LIMIT } from "./CommitmentsTable";

/** Mirrors finance-service subledger/routes.ts FINANCE_ROLES on GET /v1/finance/commitments. */
const COMMITMENT_READ_ROLES = ["finance_officer", "finance_admin", "super_admin"];

function sumMinor(rows: ReadonlyArray<Record<string, unknown>>, key: string): bigint {
  let total = 0n;
  for (const r of rows) {
    try { total += BigInt(String(r[key] ?? "0")); } catch { /* malformed amount contributes nothing */ }
  }
  return total;
}

export default async function CommitmentRegisterPage(props: { searchParams?: Promise<{ fy?: string }> }) {
  const searchParams = await props.searchParams;
  if (!getSessionRoles().some((r) => COMMITMENT_READ_ROLES.includes(r))) {
    return <PermissionDenied module="commitment register" requiredRoles={COMMITMENT_READ_ROLES} backHref="/finance" backLabel="Back to Finance" />;
  }
  const t = await getTranslations("financeCommitments");
  const fy =
    typeof searchParams?.fy === "string" && isValidFinancialYearLabel(searchParams.fy)
      ? searchParams.fy
      : currentFinancialYear();
  const [res, headRes] = await Promise.all([getFinanceCommitments(fy), getFinanceBudgetMonitoringLines(fy)]);
  const errored = toResourceState(res).status === "error";
  const rows = res.data as unknown as Record<string, unknown>[];
  // Head names are best-effort enrichment: a failed lookup degrades to the localized "Unknown head".
  const heads: Record<string, string> = {};
  for (const l of headRes.data ?? []) {
    if (l.headId) heads[l.headId] = [l.headCode, l.headName].filter(Boolean).join(" · ");
  }
  const active = rows.filter((r) => r.status === "active" || r.status === "partially_released");
  const money = (v: bigint) => (errored ? "—" : formatMoneyCompact(v.toString()));

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance" actions={<FyFilter />} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--panel)" label={t("statCommitted")} value={money(sumMinor(rows, "committed_minor"))} />
        <StatCard icon="📤" tone="info" label={t("statReleased")} value={money(sumMinor(rows, "released_minor"))} />
        <StatCard icon="🔒" tone="warn" label={t("statOutstanding")} value={money(sumMinor(rows, "balance_minor"))} />
        <StatCard icon="📌" label={t("statOpen")} value={errored ? "—" : active.length} />
      </StatGrid>
      {!errored && rows.length >= COMMITMENT_FETCH_LIMIT && (
        <div role="status" style={{ marginBottom: 12, padding: "10px 14px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--panel)", fontSize: 13 }}>
          {t("truncated", { limit: COMMITMENT_FETCH_LIMIT })}
        </div>
      )}
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "commitment register" })} backHref="/finance" />
          </div>
        ) : (
          <CommitmentsTable commitments={rows} heads={heads} source="api" />
        )}
      </Card>
    </div>
  );
}
