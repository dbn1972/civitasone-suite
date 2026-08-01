import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ClosePeriodForm } from "./ClosePeriodForm";
import { PeriodsTable, type PeriodRow } from "./PeriodsTable";
import { getSessionRoles } from "@/lib/auth/roleGuard";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapPeriods(payload: unknown): PeriodRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  const mapped: PeriodRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const period = raw.period;
    const status = raw.status;
    if (typeof period !== "string" || typeof status !== "string") continue;
    mapped.push({
      period,
      fiscalYear: typeof raw.fiscalYear === "string" ? raw.fiscalYear : "",
      status,
      closedBy: typeof raw.closedBy === "string" ? raw.closedBy : null,
      closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
    });
  }
  // Most recently touched period first.
  mapped.sort((a, b) => (b.period > a.period ? 1 : b.period < a.period ? -1 : 0));
  return mapped;
}

async function getPeriods(): Promise<LoaderResult<PeriodRow[]>> {
  return fetchJson<unknown, PeriodRow[]>("/api/v1/finance/periods", [], {
    telemetryKey: "finance.periods",
    mapResponse: mapPeriods,
  });
}

export default async function PeriodCloseCockpitPage() {
  const { data: periods, source } = await getPeriods();
  // Reopen is restricted to finance_admin/super_admin server-side; hide the
  // affordance for other roles so they aren't offered an action that 403s.
  const canReopen = getSessionRoles().some((r) => r === "finance_admin" || r === "super_admin");

  const openCount = periods.filter((p) => p.status === "open").length;
  const softClosedCount = periods.filter((p) => p.status === "soft_close").length;
  const hardClosedCount = periods.filter((p) => p.status === "hard_close").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Period-Close Cockpit"
        subtitle="Track accounting-period status and drive the soft-close, hard-close, and reopen workflow."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🟢" iconBg="#e6f7f0" label="Open" value={openCount} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Soft-Closed" value={softClosedCount} />
        <StatCard icon="🔒" iconBg="#fef3f2" label="Hard-Closed" value={hardClosedCount} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Tracked Periods" value={periods.length} />
      </StatGrid>

      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Only periods that have been closed or reopened at least once appear below — a period with no history is
        implicitly open. Use the form to soft-close a period for the first time.
      </p>

      <ClosePeriodForm />

      <Card title="Accounting Periods">
        {source === "error" && periods.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <PeriodsTable periods={periods} canReopen={canReopen} />
        )}
      </Card>
    </main>
  );
}
