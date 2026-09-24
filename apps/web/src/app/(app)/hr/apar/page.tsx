/**
 * APAR list page — Sprint 14 / Lifecycle Phase 2
 * Flow card view (APARFlowList) replaces the plain DataTable.
 * Each card shows the 4-stage SPARROW pipeline with active stage highlighted
 * and deadline countdown.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { APARFlowList, type AparRecord } from "./_components/APARFlowCard";

async function getApars() {
  return fetchJson<unknown, AparRecord[]>("/api/v1/hrms/apar", [], {
    telemetryKey: "apar.list",
    mapResponse: (p) => {
      const arr = (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? (arr as AparRecord[]) : null;
    },
  });
}

export default async function AparListPage() {
  const t = await getTranslations("apar");
  const result = await getApars();
  const apars  = result.data;

  const pending   = apars.filter(
    (a) => a.status === "pending" || a.status === "initiated",
  ).length;
  const inReview  = apars.filter((a) =>
    ["ro_review", "ro_submitted", "rv_submitted", "under_review", "cso_review"].includes(
      a.status,
    ),
  ).length;
  const disputed  = apars.filter((a) => a.status === "disputed").length;
  const completed = apars.filter(
    (a) => a.status === "closed" || a.status === "accepted",
  ).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          <Link href="/hr/apar/new" className="btn primary">
            {t("initiateBtn")}
          </Link>
        }
      />
      <DataSourceBadge source={result.source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label={t("statTotal")}        value={apars.length} />
        <StatCard icon="✍️" iconBg="#fffbe6" label={t("statSelfAppraisal")} value={pending} />
        <StatCard icon="🔍" iconBg="#e6f0ff" label={t("statUnderReview")}   value={inReview} />
        <StatCard icon="⚠️" iconBg="#fff1f0" label={t("statDisputed")}      value={disputed} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statClosed")}        value={completed} />
      </StatGrid>

      <Card title={t("flowCardTitle")}>
        <div style={{ padding: 16 }}>
          <APARFlowList records={apars} />
        </div>
      </Card>
    </main>
  );
}
