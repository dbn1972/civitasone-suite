import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from '../../../../_components/ds'
import { DataSourceBadge } from '../../../../_components/DataSourceBadge'
import { getSessionRoles } from '@/lib/auth/roleGuard'
import { PermissionDenied } from '../../../../_components/PermissionDenied'
import { toHumanError } from '@/lib/messages'
import {
  getHeadcount,
  getRetirements,
  getAnalyticsKpis,
  sumRetiringWithinMonths,
  type RetirementRow,
} from '../_data'

// Mirrors the backend's READER_ROLES for this exact module
// (workforce-planning/routes.ts) -- GAP-HR-WORKFORCE-ANALYTICS-06. Without
// this gate a plain `employee` session got a page that LOOKED broken (every
// loader 403ing, read as a generic failure) instead of an honest "Access
// restricted" message.
const WORKFORCE_ANALYTICS_ROLES = ['hr_admin', 'hr_officer', 'super_admin', 'manager', 'finance_officer']

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AnalyticsT {
  (key: string, values?: Record<string, string | number>): string
}

/* ── Metadata (GAP-HR-WORKFORCE-ANALYTICS-07) ─────────────────────────────
 * Was a hard-coded English `metadata = { title: '...' }`, bypassing
 * next-intl entirely -- a Hindi-locale visitor still saw an English browser
 * tab title. `generateMetadata` + `getTranslations` is this repo's own
 * pattern for a dynamic, translated title (see careers/[id]/page.tsx).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workforceAnalytics')
  return { title: `${t('title')} — CivitasOne HRMS` }
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
  const maxV = Math.max(...values)
  // GAP-HR-WORKFORCE-ANALYTICS-05: the axis used to scale from
  // `Math.min(...values)` to `Math.max(...values)` with no zero baseline,
  // which visually exaggerates small changes (e.g. 100->102 headcount
  // rendered as a dramatic swing across the whole chart height). Including
  // zero in the range fixes that; it's still the real data's own max at the
  // top, so a genuinely large series isn't squashed by unrelated headroom.
  const minV = Math.min(0, ...values)
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
      {/*
        GAP-HR-WORKFORCE-ANALYTICS-05: the female segment used to be a raw,
        un-tokenised hex colour (repeated twice) with no design-token
        backing, unlike every other colour in this file (which all use
        `var(--token, #fallback)`). `--violet` already exists in
        civitas-ds.css's categorical palette
        (indigo/violet/amber/rose/sky/cyan) with both light- and dark-mode
        values defined -- reused here rather than adding a redundant new
        token. Colour is still not the ONLY cue: the legend immediately
        below already renders each share as literal percentage TEXT (not
        just a coloured swatch), which is what satisfies "not colour alone"
        here -- an additional label crammed inside the bar segments
        themselves was tried and dropped, since at this bar's 18px height
        and 9px font, white text on this token's lighter dark-mode value
        cannot be guaranteed a safe contrast ratio; the legend's normal-size
        text does not have that problem.
      */}
      <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${fPct}%`, background: 'var(--violet)', transition: 'width 0.3s' }} aria-hidden />
        <div style={{ width: `${mPct}%`, background: 'var(--primary, #00439C)', transition: 'width 0.3s' }} aria-hidden />
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted, #64748b)' }}>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--violet)', marginInlineEnd: 4 }} aria-hidden />
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

  /* ── Role gate (GAP-HR-WORKFORCE-ANALYTICS-06) ──────────────────────── */
  const roles = getSessionRoles()
  const canAccess = roles.some((r) => WORKFORCE_ANALYTICS_ROLES.includes(r))
  if (!canAccess) {
    return <PermissionDenied module="workforce analytics" requiredRoles={WORKFORCE_ANALYTICS_ROLES} />
  }

  const [hc, rt, kpisResult] = await Promise.all([getHeadcount(), getRetirements(1), getAnalyticsKpis()])
  const headcount = hc.data
  const retirements = rt.data
  const analytics = kpisResult.data
  const kpisMeta = kpisResult.meta

  // GAP-HR-WORKFORCE-ANALYTICS-02/04: each card is gated on its OWN loader's
  // source -- a working Total Headcount card next to an erroring KPI card no
  // longer share one merged flag (the old code's `source ==='error' ? ... :
  // 'api'` conflated all three into a single value, so one failing endpoint
  // made every stat card blank even when its own fetch succeeded).
  //
  // Note on this item's "cache/fallback state" premise: apps/web/src/app/
  // _data/apiClient.ts's `LoaderSource` type is `"api" | "error"` only --
  // there is no third cache/fallback state in this codebase to collapse, so
  // that specific half of the original finding does not hold against the
  // current source (re-verified here, not assumed). The still-true half --
  // independent per-card status instead of one shared flag -- is what's
  // implemented below.
  const hcErrored = hc.source === 'error'
  const rtErrored = rt.source === 'error'
  const kpisErrored = kpisResult.source === 'error'
  const anyErrored = hcErrored || rtErrored || kpisErrored
  const badgeSource = anyErrored ? 'error' : 'api'

  const totalHeadcount = headcount.reduce((s, r) => s + Number(r.count), 0)
  const retiringSoon = sumRetiringWithinMonths(retirements, 6)
  const retiring12 = sumRetiringWithinMonths(retirements, 12)

  // GAP-HR-WORKFORCE-ANALYTICS-01: turnoverPct/absenteeismPct are dropped
  // from the page entirely (not shown as "—" either) -- they don't exist as
  // a same-schema, honestly-computable metric today (see routes.ts's
  // analytics-kpis handler and this PR's description for exactly why), and
  // a permanently-missing capability reads more honestly as "not built yet"
  // than as "—", which implies a transient fetch failure. Total Headcount
  // and Avg. Tenure are both real, so they're the only two KPI stat cards.
  const kpiCards = [
    {
      icon: '👥',
      iconBg: 'var(--infobg, #e6f0ff)',
      label: t('statTotalHeadcount'),
      value: hcErrored ? null : totalHeadcount,
    },
    {
      icon: '📅',
      iconBg: 'var(--goodbg, #e6f7f0)',
      label: t('statAvgTenure'),
      value:
        kpisErrored || analytics.avgTenureYears === null
          ? null
          : analytics.avgTenureYears.toFixed(1),
    },
  ]

  const rtCols: { key: keyof RetirementRow & string; label: string; align?: 'left' | 'right' }[] = [
    { key: 'period', label: t('colPeriod') },
    { key: 'retiring_count', label: t('colRetiringCount'), align: 'right' },
  ]

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={badgeSource} />
      {anyErrored && (
        <div style={{ marginBottom: 16 }}>
          <RefreshErrorState error={toHumanError('load', { area: 'workforce analytics' })} backHref="/hr/workforce" />
        </div>
      )}

      <StatGrid>
        {kpiCards.map((k) => (
          <StatCard key={k.label} icon={k.icon} iconBg={k.iconBg} label={k.label} value={k.value} />
        ))}
      </StatGrid>

      {/* Monthly trend chart -- honestly empty until a real cross-module read model exists (GAP-HR-WORKFORCE-ANALYTICS-01) */}
      <Card title={t('cardMonthlyTrend')}>
        <div style={{ padding: '8px 0' }}>
          <TrendChart data={kpisErrored ? [] : analytics.monthlyTrend ?? []} t={t} />
        </div>
      </Card>

      {/* Gender diversity */}
      <Card title={t('cardGenderDiversity')}>
        <div style={{ padding: '12px 0' }}>
          {/*
            GAP-HR-WORKFORCE-ANALYTICS-06: per the published decision packet,
            applying default -- threshold=10. Suppressed at the source
            (routes.ts never sends these fields below the threshold), so
            there is nothing to hide here except the explanatory copy itself.
          */}
          {kpisErrored ? (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('genderNoData')}</span>
          ) : analytics.genderRatioF === undefined || analytics.genderRatioM === undefined ? (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('genderSuppressedNote', { threshold: kpisMeta.genderSuppressionThreshold })}
            </span>
          ) : (
            <GenderBar female={analytics.genderRatioF} male={analytics.genderRatioM} t={t} />
          )}
        </div>
      </Card>

      {/* Retirement risk */}
      <Card title={t('cardRetirementForecast')}>
        <div style={{ padding: '12px 0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                // GAP-HR-WORKFORCE-ANALYTICS-02: neutral colour on error --
                // a `0` rendered in the SUCCESS green when the fetch actually
                // failed read as "confirmed zero risk", not "unknown".
                color: rtErrored ? 'var(--muted, #64748b)' : retiringSoon > 0 ? 'var(--bad, #cf1322)' : 'var(--good, #1a6d3c)',
              }}
            >
              {rtErrored ? '—' : retiringSoon}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
              {t('retiringWithin6')}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: rtErrored ? 'var(--muted, #64748b)' : retiring12 > 0 ? 'var(--warn, #d46b08)' : 'var(--good, #1a6d3c)',
              }}
            >
              {rtErrored ? '—' : retiring12}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #64748b)' }}>
              {t('retiringWithin12')}
            </div>
          </div>
        </div>
        {/*
          GAP-HR-WORKFORCE-ANALYTICS-03/08: the hand-rolled table (no sort,
          no filter, no mobile-card layout) is replaced by the same shared
          DataTable every other page in this module uses, over the real
          period/retiring_count shape -- there is no per-officer identity in
          the payload to render a name/department column from (see the
          WORKFORCE-05-refuted note: adding one would recreate that exact
          risk).
        */}
        {rtErrored ? (
          <RefreshErrorState error={toHumanError('load', { area: 'retirement forecast' })} />
        ) : (
          <div style={{ marginTop: 12 }}>
            <DataTable<RetirementRow>
              columns={rtCols}
              rows={retirements}
              sortable
              pageSize={8}
              caption={t('ariaUpcomingRetirements')}
              emptyIcon="📅"
              emptyTitle={t('emptyRetirementsTitle')}
              emptyMessage={t('emptyRetirementsMessage')}
            />
          </div>
        )}
      </Card>
    </div>
  )
}
