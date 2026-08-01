import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { RecurringEntryForm, type AccountOption } from "./RecurringEntryForm";

type RawRow = {
  id: string;
  name: string;
  voucher_type: string;
  frequency: string;
  amount_minor: string | number;
  next_run_date: string;
  end_date: string | null;
  is_active: boolean;
} & Record<string, unknown>;

export type RecurringEntryRow = {
  id: string;
  name: string;
  voucherType: string;
  frequency: string;
  amountMinor: string | number;
  nextRunDateDisplay: string;
  endDateDisplay: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapRecurringEntries(payload: unknown): RecurringEntryRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: RecurringEntryRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    mapped.push({
      id: row.id,
      name: row.name,
      voucherType: String(row.voucher_type ?? "journal"),
      frequency: String(row.frequency ?? ""),
      amountMinor: row.amount_minor ?? 0,
      nextRunDateDisplay: formatIndianDate(row.next_run_date ?? null),
      endDateDisplay: row.end_date ? formatIndianDate(row.end_date) : "—",
      statusLabel: row.is_active ? "active" : "inactive",
    });
  }
  return mapped;
}

function mapAccountOptions(payload: unknown): AccountOption[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: AccountOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const code = raw.code;
    const name = raw.name;
    if (typeof id !== "string" || typeof code !== "string" || typeof name !== "string") continue;
    mapped.push({ id, code, name });
  }
  return mapped.length > 0 ? mapped : null;
}

async function getRecurringEntries(): Promise<LoaderResult<RecurringEntryRow[]>> {
  return fetchJson<unknown, RecurringEntryRow[]>("/api/v1/finance/recurring-entries", [], {
    telemetryKey: "finance.recurring_entries",
    mapResponse: mapRecurringEntries,
  });
}

async function getAccountOptions(): Promise<LoaderResult<AccountOption[]>> {
  return fetchJson<unknown, AccountOption[]>("/api/v1/finance/accounts", [], {
    telemetryKey: "finance.recurring_entries.accounts",
    mapResponse: mapAccountOptions,
  });
}

export default async function RecurringEntriesPage() {
  const [{ data: entries, source }, { data: accounts }] = await Promise.all([
    getRecurringEntries(),
    getAccountOptions(),
  ]);

  const active = entries.filter((e) => e.statusLabel === "active").length;

  const columns: { key: keyof RecurringEntryRow; label: string; cellType?: "status" | "amount" }[] = [
    { key: "name", label: "Name" },
    { key: "voucherType", label: "Voucher Type" },
    { key: "frequency", label: "Frequency" },
    { key: "amountMinor", label: "Amount", cellType: "amount" },
    { key: "nextRunDateDisplay", label: "Next Run" },
    { key: "endDateDisplay", label: "End Date" },
    { key: "statusLabel", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Recurring Entries"
        subtitle="Standing journal instructions that post automatically on a schedule."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🔁" iconBg="#e6f0ff" label="Total Templates" value={entries.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
      </StatGrid>

      <RecurringEntryForm accounts={accounts} />

      <Card title="Recurring Entry Templates">
        <DataTable<RecurringEntryRow>
          columns={columns}
          rows={entries}
          sortable
          filterable
          filterPlaceholder="Filter by name…"
          pageSize={15}
          emptyIcon="🔁"
          emptyTitle="No recurring entries yet"
          emptyMessage="Create your first standing journal instruction using the form above."
        />
      </Card>
    </main>
  );
}
