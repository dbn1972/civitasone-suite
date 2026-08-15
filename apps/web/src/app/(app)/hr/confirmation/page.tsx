/**
 * Probation Confirmation page — Sprint 14 / Lifecycle Phase 2
 * Card grid via ProbationConfirmationList (replaces plain DataTable).
 */
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import {
  ProbationConfirmationList,
  type ConfirmationRow,
} from "./_components/ProbationConfirmationCard";

async function getData(): Promise<LoaderResult<ConfirmationRow[]>> {
  return fetchJson<unknown, ConfirmationRow[]>("/api/v1/hrms/confirmations", [], {
    telemetryKey: "hr.confirmations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ConfirmationRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ConfirmationPage() {
  const { data: items, source } = await getData();

  const today    = new Date().toISOString().slice(0, 10);
  const overdue  = items.filter((r) => r.dueDate && r.dueDate < today).length;
  const dueSoon  = items.filter((r) => {
    if (!r.dueDate || r.dueDate < today) return false;
    const diff = Math.ceil(
      (new Date(r.dueDate).getTime() - Date.now()) / 86_400_000,
    );
    return diff <= 30;
  }).length;
  const timely   = Math.max(0, items.length - overdue - dueSoon);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Probation Confirmations"
        subtitle="Employees due for service confirmation after the mandatory 2-year probation (CCS Conduct Rules)."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="On Probation"   value={items.length} />
        <StatCard icon="⏰" iconBg="#fff1f0" label="Overdue"         value={overdue} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Due in 30 Days" value={dueSoon} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Timely"          value={timely} />
      </StatGrid>

      <Card title="Probation Register — Confirmation Due">
        <div style={{ padding: 16 }}>
          <ProbationConfirmationList rows={items} />
        </div>
      </Card>
    </main>
  );
}
