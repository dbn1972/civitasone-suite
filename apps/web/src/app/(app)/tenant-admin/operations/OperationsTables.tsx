"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import type { AdminOperationProcess, AdminOperationScheduler } from "../../../_data/loaders";

function statusClass(status: string): string {
  if (status === "online" || status === "ok") return "good";
  if (status === "unknown" || status === "degraded") return "warn";
  return "bad";
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

type ProcessRow = AdminOperationProcess & Record<string, unknown>;
type SchedulerRow = AdminOperationScheduler & Record<string, unknown>;
type ErrorRow = { source: string; line: string } & Record<string, unknown>;

export function ProcessesTable({ processes }: { processes: AdminOperationProcess[] }) {
  if (processes.length === 0) {
    return <EmptyState icon="🖥️" title="No PM2 data" message="Install PM2 on the app host and expose it to admin-service to populate process health." />;
  }
  const rows = processes as ProcessRow[];
  return (
    <DataTable<ProcessRow>
      columns={[
        { key: "name", label: "Process", render: (p) => <span className="mono">{p.name as string}</span> },
        { key: "kind", label: "Type" },
        { key: "status", label: "Status", render: (p) => <span className={`pill ${statusClass(p.status as string)}`}>{p.status as string}</span> },
        { key: "restarts", label: "Restarts" },
        { key: "cpuPct", label: "CPU", render: (p) => <>{p.cpuPct}%</> },
        { key: "memoryMb", label: "Memory", render: (p) => <>{p.memoryMb} MB</> },
        { key: "uptimeSeconds", label: "Uptime", render: (p) => formatDuration(p.uptimeSeconds as number | null) },
      ]}
      rows={rows}
    />
  );
}

export function SchedulersTable({ schedulers }: { schedulers: AdminOperationScheduler[] }) {
  if (schedulers.length === 0) {
    return <EmptyState icon="⏱️" title="No scheduler data" message="Scheduler ownership will appear once operations data is available." />;
  }
  const rows = schedulers as SchedulerRow[];
  return (
    <DataTable<SchedulerRow>
      columns={[
        { key: "name", label: "Scheduler" },
        { key: "ownerProcess", label: "Owner", render: (j) => <span className="mono">{j.ownerProcess as string}</span> },
        { key: "schedule", label: "Schedule" },
        { key: "status", label: "Status", render: (j) => <span className={`pill ${statusClass(j.status as string)}`}>{j.status as string}</span> },
        { key: "lastObservedAt", label: "Last cron run", render: (j) => formatDate(j.lastObservedAt as string | undefined) },
      ]}
      rows={rows}
    />
  );
}

export function RecentErrorsTable({ errors }: { errors: { source: string; line: string }[] }) {
  return (
    <DataTable<ErrorRow>
      columns={[
        { key: "source", label: "Source", render: (e) => <span className="mono">{e.source as string}</span> },
        { key: "line", label: "Redacted error", render: (e) => <span className="mono">{e.line as string}</span> },
      ]}
      rows={errors as ErrorRow[]}
    />
  );
}
