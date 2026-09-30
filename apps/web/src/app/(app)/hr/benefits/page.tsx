import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { ElectionForm, type BenefitPlan } from "./_components/ElectionForm";

type ApiElection = {
  id: string;
  plan_name: string;
  fy: string;
  elections: Array<{ component: string; electedMinor: number }>;
  total_elected_minor: number;
  status: string;
};

type Row = {
  id: string;
  plan_name: string;
  fy: string;
  total_elected: number | null;
  components: string;
  status: string;
} & Record<string, unknown>;

// GAP-HR-BENEFITS-05: raw election-component keys ("hra", "ltc", ...) have no
// label map, so the Components column joined bare keys. Plan components are
// tenant-defined free text (see gap-features/routes.ts POST /benefits/plans),
// so an unknown key still falls back to a title-cased version of itself
// rather than blank.
function labelForComponent(key: string, t: (k: string) => string): string {
  const k = key.trim().toLowerCase();
  const known = new Set(["hra", "ltc", "medical", "flex"]);
  if (known.has(k)) {
    try {
      return t(`component.${k}`);
    } catch {
      /* fall through to the generic fallback below */
    }
  }
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapElections(rows: ApiElection[], labelFor: (key: string) => string): Row[] {
  return rows.map((e) => ({
    id: e.id,
    plan_name: e.plan_name ?? "—",
    fy: e.fy ?? "—",
    total_elected: e.total_elected_minor ?? null,
    components: Array.isArray(e.elections) && e.elections.length > 0
      ? e.elections.map((c) => labelFor(c.component)).join(", ")
      : "—",
    status: e.status ?? "active",
  }));
}

async function getData(labelFor: (key: string) => string): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/benefits/my-elections", [], {
    telemetryKey: "hr.benefits",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiElection[] })?.data;
      return Array.isArray(arr) ? mapElections(arr as ApiElection[], labelFor) : null;
    },
  });
}

async function getPlans(): Promise<BenefitPlan[]> {
  const r = await fetchJson<unknown, BenefitPlan[]>("/api/v1/hrms/benefits/plans", [], {
    telemetryKey: "hr.benefits.plans",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: BenefitPlan[] })?.data;
      return Array.isArray(arr) ? (arr as BenefitPlan[]) : null;
    },
  });
  return r.data ?? [];
}

export default async function BenefitsPage() {
  const t = await getTranslations("benefits");
  const labelFor = (key: string) => labelForComponent(key, t);
  const result = await getData(labelFor);
  const { data: items, source } = result;
  const errored = source === "error";
  const plans = errored ? [] : await getPlans();

  const active = items.filter((i) => i.status === "active").length;
  const processing = items.filter((i) => ["processing", "pending", "submitted"].includes(i.status)).length;
  const closed = items.filter((i) => ["closed", "lapsed", "expired"].includes(i.status)).length;
  // GAP-HR-BENEFITS-04: any status outside the three buckets above (e.g.
  // "draft", "cancelled") used to be counted only in Total, so the tiles
  // never summed to it. Surface the residual explicitly instead of hiding it.
  const other = Math.max(0, items.length - active - processing - closed);

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" }[] = [
    { key: "plan_name", label: t("colPlan") },
    { key: "fy", label: t("colFinancialYear") },
    { key: "components", label: t("colComponents") },
    { key: "total_elected", label: t("colTotalElected"), cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={!errored ? <ElectionForm plans={plans} /> : undefined}
      />
      {/* GAP-HR-BENEFITS-06: DataSourceBadge only ever shows on this page when
          source === "error" (its own no-op branch for anything else), which
          made it fire alongside the error-state card below and say the
          same "couldn't load" thing twice. The card already carries that
          message (and, for a 403, the more specific PermissionDenied one),
          so the separate badge added nothing and is dropped rather than
          conditionally hidden. */}
      <StatGrid>
        <StatCard icon="🏥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalEnrollmentsLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? null : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statProcessingLabel")} value={errored ? null : processing} />
        <StatCard icon="📁" iconBg="var(--bg, #f5f5f5)" label={t("statClosedLabel")} value={errored ? null : closed} />
        {!errored && other > 0 && (
          <StatCard icon="❔" iconBg="var(--mutbg, #f1f5f9)" label={t("statOtherLabel")} value={other} />
        )}
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="benefits" backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🏥"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
