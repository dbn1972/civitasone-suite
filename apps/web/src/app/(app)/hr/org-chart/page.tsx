import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatGrid, StatCard, RefreshErrorState } from '../../../_components/ds'
import { DataSourceBadge } from '../../../_components/DataSourceBadge'
import { getOrgChart } from '../../../_data/loaders'
import { toHumanError } from "@/lib/messages";
import type { OrgChartNode } from '@civitasone/types'
import { OrgChartClient } from './OrgChartClient'

function countAll(nodes: OrgChartNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + 1 + countAll((n.children ?? []) as OrgChartNode[]),
    0,
  )
}

// GAP-HR-ORG-CHART-02: managers/uniqueDepts used to be computed over the
// top-level `nodes` array only (only countAll already recursed), understating
// both for any employee below the first level. Flatten the whole tree once
// -- same flatMap idiom as OrgChartClient's collectAllIds -- so every
// "across all employees" stat is derived from the full tree.
function flatten(nodes: OrgChartNode[]): OrgChartNode[] {
  return nodes.flatMap((n) => [n, ...flatten((n.children ?? []) as OrgChartNode[])])
}

export const metadata = { title: 'Organisation Chart — CivitasOne HRMS' }

export default async function OrgChartPage() {
  const t = await getTranslations("orgChart");
  const { data: nodes, source } = await getOrgChart()
  // GAP-HR-ORG-CHART-03: on a backend error `nodes` is `[]` and every stat
  // below would compute to a fabricated 0 -- `errored` gates the stat cards
  // to `null` (StatCard already renders "—" for that) instead.
  const errored = source === 'error'

  const flat = flatten(nodes)
  const managers = flat.filter((n) => n.children && n.children.length > 0).length
  const uniqueDepts = new Set(flat.map((n) => n.department)).size
  // GAP-HR-ORG-CHART-02/05: the API (orgchart/queries.ts) already returns
  // only root nodes -- re-filtering by `!reportsTo` here duplicated that
  // client-side computation unnecessarily.
  const roots = nodes.length
  const totalCount = countAll(nodes)

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalEmployees")} value={errored ? null : totalCount} />
        <StatCard icon="🏢" iconBg="var(--goodbg, #e6f7f0)" label={t("statDepartments")} value={errored ? null : uniqueDepts} />
        <StatCard icon="💼" iconBg="var(--warnbg, #fff7e6)" label={t("statManagers")} value={errored ? null : managers} />
        <StatCard icon="🌟" iconBg="var(--bg, #f5f5f5)" label={t("statRootHeads")} value={errored ? null : roots} />
      </StatGrid>
      <Card padding>
        {errored ? (
          <RefreshErrorState error={toHumanError('load', { area: 'organisation chart' })} backHref="/hr" />
        ) : (
          <OrgChartClient data={nodes} />
        )}
      </Card>
    </div>
  )
}
