import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { FiscalYearForm } from "./FiscalYearForm";
import { FiscalYearsTable, type FiscalYearRow } from "./FiscalYearsTable";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapFiscalYears(payload: unknown): FiscalYearRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: FiscalYearRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const code = raw.code;
    const label = raw.label;
    const startDate = raw.startDate;
    const endDate = raw.endDate;
    const status = raw.status;
    if (typeof code !== "string" || typeof label !== "string") continue;
    mapped.push({
      code,
      label,
      startDate: typeof startDate === "string" ? startDate : "",
      endDate: typeof endDate === "string" ? endDate : "",
      status: typeof status === "string" ? status : "unknown",
    });
  }
  return mapped;
}

async function getFiscalYears(): Promise<LoaderResult<FiscalYearRow[]>> {
  return fetchJson<unknown, FiscalYearRow[]>("/api/v1/finance/fiscal-years", [], {
    telemetryKey: "finance.fiscal_years",
    mapResponse: mapFiscalYears,
  });
}

export default async function FiscalYearsPage() {
  const { data: fiscalYears, source } = await getFiscalYears();
  const activeYear = fiscalYears.find((fy) => fy.status === "active");

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fiscal Years"
        subtitle="Define financial years and set the one currently open for posting."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f0ff" label="Total Fiscal Years" value={fiscalYears.length} />
        <StatCard icon="🟢" iconBg="#e6f7f0" label="Active Fiscal Year" value={activeYear?.code ?? "—"} />
      </StatGrid>

      <FiscalYearForm />

      <FiscalYearsTable rows={fiscalYears} />
    </main>
  );
}
