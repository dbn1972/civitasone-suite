import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatGrid, StatCard } from '../../../_components/ds'
import { DataSourceBadge } from '../../../_components/DataSourceBadge'
import { getOrgChart } from '../../../_data/loaders'
import type { OrgChartNode } from '@civitasone/types'
import { OrgChartClient } from './OrgChartClient'

function countAll(nodes: OrgChartNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + 1 + countAll((n.children ?? []) as OrgChartNode[]),
    0,
  )
}

export const metadata = { title: 'Organisation Chart — CivitasOne HRMS' }

export default async function OrgChartPage() {
  const t = await getTranslations("orgChart");
  const { data: nodes, source } = await getOrgChart()

  const managers = nodes.filter((n) => n.children && n.children.length > 0).length
  const uniqueDepts = new Set(nodes.map((n) => n.department)).size
  const roots = nodes.filter((n) => !n.reportsTo).length
  const totalCount = countAll(nodes)

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalEmployees")} value={totalCount} />
        <StatCard icon="🏢" iconBg="var(--goodbg, #e6f7f0)" label={t("statDepartments")} value={uniqueDepts} />
        <StatCard icon="💼" iconBg="var(--warnbg, #fff7e6)" label={t("statManagers")} value={managers} />
        <StatCard icon="🌟" iconBg="var(--bg, #f5f5f5)" label={t("statRootHeads")} value={roots} />
      </StatGrid>
      <Card padding>
        <OrgChartClient data={nodes} />
      </Card>
    </main>
  )
}
