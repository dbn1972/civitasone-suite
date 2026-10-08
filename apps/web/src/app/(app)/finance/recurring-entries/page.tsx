import { PageHeader, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite, RECURRING_WRITE_ROLES } from "@/lib/finance/writeRoles";
import { RecurringEntryForm, type AccountOption } from "./RecurringEntryForm";
import { RecurringEntriesTable, type RecurringEntryRow } from "./RecurringEntriesTable";

// GAP2-FINANCE-RECURRING-ENTRIES-08: the API now returns a validated camelCase
// contract (id, name, voucherType, frequency, amountMinor, nextRunDate,
// endDate, isActive) with the internal account UUIDs / created_by dropped.
type RawRow = {
  id: string;
  name: string;
  voucherType: string;
  frequency: string;
  amountMinor: string | number;
  nextRunDate: string | null;
  endDate: string | null;
  isActive: boolean;
} & Record<string, unknown>;

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
      voucherType: String(row.voucherType ?? "journal"),
      frequency: String(row.frequency ?? ""),
      amountMinor: row.amountMinor ?? 0,
      nextRunDateDisplay: formatIndianDate(row.nextRunDate ?? null),
      endDateDisplay: row.endDate ? formatIndianDate(row.endDate) : "—",
      statusLabel: row.isActive ? "active" : "inactive",
      // inactive AND already past its end date: neither Resume nor End applies
      ended: !row.isActive && !!row.endDate && String(row.endDate).slice(0, 10) <= todayIST(),
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
  // An empty chart of accounts is a valid answer, not an invalid payload: returning
  // null here made fetchJson report a false "error" for it (GAP-FINANCE-RECURRING-ENTRIES-03).
  return mapped;
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
  const [entriesResult, { data: accounts, source: accountsSource }] = await Promise.all([
    getRecurringEntries(),
    getAccountOptions(),
  ]);
  const { data: entries, source } = entriesResult;

  // GAP2-FINANCE-RECURRING-ENTRIES-07: a failed /recurring-entries read must not
  // render as a believable "Total Templates 0 / Active 0" clean record next to
  // the table's own "no recurring entries" empty state. Mirror period-close:
  // one error state (403 -> access-restricted) replaces the stats, the create
  // form and the table. A genuine empty (200 []) still shows the empty state.
  if (source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Recurring Entries"
          subtitle="Standing journal instructions for recurring transactions."
          back="/finance"
        />
        <LoadErrorState result={entriesResult} area="recurring entries" backHref="/finance" />
      </div>
    );
  }

  const active = entries.filter((e) => e.statusLabel === "active").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Recurring Entries"
        subtitle="Standing journal instructions for recurring transactions."
        back="/finance"
      />

      <StatGrid>
        <StatCard icon="🔁" iconBg="#e6f0ff" label="Total Templates" value={entries.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
      </StatGrid>

      <RecurringEntryForm accounts={accounts} accountsError={accountsSource === "error"} />

      <RecurringEntriesTable entries={entries} canWrite={canWrite(getSessionRoles(), RECURRING_WRITE_ROLES)} />
    </div>
  );
}
