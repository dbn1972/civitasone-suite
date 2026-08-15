import { PageHeader, StatGrid, StatCard, Card } from '../../../_components/ds'
import { DataSourceBadge } from '../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'
import { DirectoryClient } from './DirectoryClient'

export const metadata = { title: 'Employee Directory — CivitasOne HRMS' }

type Row = {
  id: string
  name: string
  department: string
  designation: string
  grade: string
  extension: string
  email: string
  location: string
} & Record<string, unknown>

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>('/api/v1/hrms/employees?limit=200', [], {
    telemetryKey: 'hr.employees_limit_200',
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data
      return Array.isArray(arr) ? arr : null
    },
  })
}

export default async function DirectoryPage() {
  const { data: items, source } = await getData()

  const depts = new Set(items.map((i) => i.department).filter(Boolean)).size
  const locations = new Set(items.map((i) => i.location).filter(Boolean)).size
  const designations = new Set(items.map((i) => i.designation).filter(Boolean)).size

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Employee Directory"
        subtitle="Search employees by name, department, designation, extension, or location."
        back="/hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Employees" value={items.length} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Departments" value={depts} />
        <StatCard icon="📍" iconBg="#fffbe6" label="Locations" value={locations} />
        <StatCard icon="📛" iconBg="#e6f7f0" label="Designations" value={designations} />
      </StatGrid>
      <Card title="Directory">
        <DirectoryClient employees={items} />
      </Card>
    </main>
  )
}
