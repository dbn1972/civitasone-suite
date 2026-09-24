import { getTranslations } from 'next-intl/server'
import { PageHeader, StatGrid, StatCard, Card } from '../../../../_components/ds'
import { DataSourceBadge } from '../../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'

export const metadata = { title: 'Workforce Analytics — CivitasOne HRMS' }

/* ── Types ─────────────────────────────────────────────────────────────── */

type HeadcountRow = { group_key: string; count: number } & Record<string, unknown>
type RetirementRow = {
  employeeId: string
  fullName: string
  department?: string
  monthsLeft?: number
} & Record<string, unknown>

interface AnalyticsKpis {
  turnoverPct: number
  absenteeismPct: number
  avgTenureYears: number
  genderRatioF: number
  genderRatioM: number
  monthlyTrend: { month: string; headcount: number }[]
}

type AnalyticsT = Awaited<ReturnType<typeof getTranslations>>

/* ── Loaders ───────────────────────────────────────────────────────────── */

async function getHeadcount(): Promise<LoaderResult<HeadcountRow[]>> {
  return fetchJson<unknown, HeadcountRow[]>(
    '/api/v1/hrms/workforce/headcount?groupBy=department',
    [],
    {
      telemetryKey: 'hr.workforce.headcount',
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: HeadcountRow[] })?.data
        return Array.isArray(arr) ? arr : null
      },
    },
  )
}

async function getRetirements(): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>(
    '/api/v1/hrms/workforce/retirement-forecast',
    [],
    {
      telemetryKey: 'hr.workforce.retirement',
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: RetirementRow[] })?.data
        return Array.isArray(arr) ? arr : null
      },
    },
  )
}

async function getKpis(): Promise<LoaderResult<AnalyticsKpis>> {
  const empty: AnalyticsKpis = {
    turnoverPct: 0,
    absenteeismPct: 0,
    avgTenureYears: 0,
    genderRatioF: 0,
    genderRatioM: 0,
    monthlyTrend: [],
  }
  return fetchJson<unknown, AnalyticsKpis>('/api/v1/hrms/workforce/analytics-kpis', empty, {
    telemetryKey: 'hr.workforce.analytics-kpis',
    mapResponse: (p) => (p && typeof p === 'object' ? (p as AnalyticsKpis) : null),
  })
}

/* ── Inline SVG trend chart ────────────────────────────────────────────── */

function TrendChart({
  data,
  t,
}: {
  data: { month: string; headcount: number }[]
  t: AnalyticsT
}) {
  if (data.length < 2) {
    return (
      <p style={{ color: 'var(--muted, #64748b)', fontSize: 13, padding: '16px 0' }}>
        {t('trendNotAvailable')}
      </p>
    )
  }

  const W = 560
  const H = 160
  const PAD = { top: 16, right: 20, bottom: 36, left: 52 }

  const values = data.map((d) => d.headcount)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const rangeV = maxV - minV || 1

  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const n = data.length

  const px = (i: number) => PAD.left + (i / (n - 1)) * chartW
  const py = (v: number) => PAD.top + chartH - ((v - minV) / rangeV) * chartH

  // Build SVG path
  const points = data.map((d, i) => `${px(i)},${py(d.headcount)}`)
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `M ${px(0)},${py(minV)} L ${points.join(' L ')} L ${px(n - 1)},${py(minV)} Z`

  // Y-axis ticks
  const yTicks = [minV, Math.round((minV + maxV) / 2), maxV]

  // X-axis labels (show every other if too many)
  const showEvery = n > 8 ? 3 : n > 5 ? 2 : 1

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('trendAriaLabel', { from: data[0]?.month ?? '', to: data[n - 1]?.month ?? '' })}
        style={{ width: '100%', maxWidth: W, minWidth: 280, display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{t('trendChartTitle')}</title>
        {/* Y-axis grid lines and labels */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={py(tick)}
              x2={W - PAD.right}
              y2={py(tick)}
              stroke="var(--border, #e2e8f0)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={PAD.left - 6}
              y={py(tick) + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted, #64748b)"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="var(--primary, #00439C)" fillOpacity={0.08} />

        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--primary, #00439C)" strokeWidth={2} strokeLinejoin="round" />

        {/* Data points */}
        {data.map((d, i) => (
          <g key={d.month}>
            <circle
              cx={px(i)}
              cy={py(d.headcount)}
              r={4}
              fill="var(--primary, #00439C)"
              stroke="var(--panel, #fff)"
              strokeWidth={1.5}
              aria-label={`${d.month}: ${d.headcount}`}
            />
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (i % showEvery !== 0) return null
          return (
            <text
              key={d.month}
              x={px(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted, #64748b)"
            >
              {d.month}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Gender ratio bar ──────────────────────────────────────────────────── */

function GenderBar({ female, male, t }: { female: number; male: number; t: AnalyticsT }) {
  const total = female + male
  if (total === 0) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('genderNoData')}</span>
  const fPct = Math.round((female / total) * 100)
  const mPct = 100 - fPct
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 300 }}
      role="img"
      aria-label={t('genderRatioAriaLabel', { female: fPct, male: mPct })}
    >
      <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${fPct}%`, background: '#e040fb', transition: 'width 0.3s' }} aria-hidden />
        <div style={{ width: `${mPct}%`, background: 'var(--primary, #00439C)', transition: 'width 0.3s' }} aria-hidden />
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted, #64748b)' }}>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e040fb', marginInlineEnd: 4 }} aria-hidden />
          {t('genderFemaleLabel', { pct: fPct })}
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--primary, #00439C)', marginInlineEnd: 4 }} aria-hidden />
          {t('genderMaleLabel', { pct: mPct })}
        </span>
      </div>
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default async function WorkforceAnalyticsPage() {
  const t = await getTranslations('workforceAnalytics')
  const [hc, rt, kpis] = await Promise.all([getHeadcount(), getRetirements(), getKpis()])
  const headcount = hc.data
  const retirements = rt.data
  const analytics = kpis.data
  const source =
    hc.source === 'error' || rt.source === 'error' || kpis.source === 'error'
      ? 'error'
      : 'api'

  const totalHeadcount = headcount.reduce((s, r) => s + Number(r.count), 0)
  const retiringSoon = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 6).length
  const retiring12 = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 12).length

  const kpiCards = [
    {
      icon: '📉',
      iconBg: 'var(--badbg, #fff1f0)',
      label: t('statTurnoverRate'),
      value: `${analytics.turnoverPct.toFixed(1)}%`,
    },
    {
      icon: '🏥',
      iconBg: 'var(--warnbg, #fffbe6)',
      label: t('statAbsenteeismRate'),
      value: `${analytics.absenteeismPct.toFixed(1)}%`,
    },
    {
      icon: '📅',
      iconBg: 'var(--goodbg, #e6f7f0)',
      label: t('statAvgTenure'),
      value: analytics.avgTenureYears.toFixed(1),
    },
    {
      icon: '👥',
      iconBg: 'var(--infobg, #e6f0ff)',
      label: t('statTotalHeadcount'),
      value: totalHeadcount,
    },
  ]

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        {kpiCards.map((k) => (
          <StatCard key={k.label} icon={k.icon} iconBg={k.iconBg} label={k.label} value={k.value} />
        ))}
      </StatGrid>

      {/* Monthly trend chart */}
      <Card title={t('cardMonthlyTrend')}>
        <div style={{ padding: '8px 0' }}>
          <TrendChart data={analytics.monthlyTrend} t={t} />
        </div>
      </Card>

      {/* Gender diversity */}
      <Card title={t('cardGenderDiversity')}>
        <div style={{ padding: '12px 0' }}>
          <GenderBar female={analytics.genderRatioF} male={analytics.genderRatioM} t={t} />
        </div>
      </Card>

      {/* Retirement risk */}
      <Card title={t('cardRetirementForecast')}>
        <div style={{ padding: '12px 0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div
              style={{ fontSize: 28, fontWeight: 800, color: retiringSoon > 0 ? 'var(--bad, #cf1322)' : 'var(--good, #1a6d3c)' }}
            >
              {retiringSoon}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
              {t('retiringWithin6')}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: retiring12 > 0 ? 'var(--warn, #d46b08)' : 'var(--good, #1a6d3c)' }}>
              {retiring12}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
              {t('retiringWithin12')}
            </div>
          </div>
        </div>
        {retirements.length > 0 && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
              aria-label={t('ariaUpcomingRetirements')}
            >
              <thead>
                <tr>
                  {[t('colOfficerName'), t('colDepartment'), t('colMonthsLeft')].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '8px 10px',
                        textAlign: 'start',
                        borderBottom: '2px solid var(--border, #e2e8f0)',
                        fontWeight: 700,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: 'var(--muted, #64748b)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {retirements.slice(0, 8).map((r) => {
                  const months = Number(r.monthsLeft ?? 99)
                  return (
                    <tr
                      key={r.employeeId}
                      style={{ borderBottom: '1px solid var(--border, #e2e8f0)' }}
                    >
                      <td style={{ padding: '8px 10px' }}>{r.fullName}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--muted, #64748b)' }}>
                        {r.department ?? '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            color: months <= 6 ? 'var(--bad, #cf1322)' : months <= 12 ? 'var(--warn, #d46b08)' : undefined,
                            fontWeight: months <= 6 ? 700 : undefined,
                          }}
                        >
                          {months < 99 ? months : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  )
}
