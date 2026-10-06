import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, HelpTip } from "@/app/_components/ds";
import { getAnalyticsKpis } from "@/app/_data/loaders";
import { KpiTable } from "./KpiTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function KpiPage() {
  const result = await getAnalyticsKpis();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-ANALYTICS-KPI-01: the old "On Target / Below Target / Improving" stats
  // were derived by string-matching the preformatted `trend` ("↑", "+") and
  // comparing `currentValue === target` as strings. The analytics API does not
  // return a direction/polarity or a computed status (currentValue, target and
  // trend are placeholder "—" strings today, see analytics-service kpi/routes),
  // so a KPI where "up is bad" (e.g. file-disposal days ↑) was counted On
  // Target and Improving, and a falling vacancy rate counted Below Target. That
  // misreports performance on an executive surface, so the heuristic stats are
  // removed. Only the one count we can state honestly — the number of KPIs — is
  // kept until the API returns numeric values with an explicit status.
  const total = errored ? null : rows.length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="KPI Library" subtitle="Organisation-wide Key Performance Indicators with targets and trends." back="/analytics" />
      <StatGrid>
        <StatCard icon="🎯" tone="info" label="Total KPIs" value={total ?? "—"} />
      </StatGrid>
      <Card
        title="KPI Register"
        link={
          <HelpTip term="On/Below Target">
            Target status is not shown as a headline count yet: the analytics service does not
            return a numeric value, target and direction (whether higher or lower is better) for
            each KPI, so a reliable On/Below Target total can't be computed. Each row's current
            value, target and trend are shown as reported.
          </HelpTip>
        }
      >
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "KPIs" })} backHref="/analytics" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="No KPIs defined"
            message="No Key Performance Indicators have been configured. KPIs are defined from saved metrics in the analytics service; contact your analytics administrator to add them."
          />
        ) : (
          <KpiTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </div>
  );
}
