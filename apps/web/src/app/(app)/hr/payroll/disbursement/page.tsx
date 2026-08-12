import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { BankFileForm } from "./BankFileForm";
import { NachMandateForm } from "./NachMandateForm";
import { NachReturnForm } from "./NachReturnForm";
import { SponsorBankConfigForm } from "./SponsorBankConfigForm";
import { DscConfigForm } from "./DscConfigForm";

type RunRow = {
  id: string;
  runDate: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  status: "draft" | "processing" | "completed" | "paid" | string;
} & Record<string, unknown>;

type SponsorConfig = {
  tenantId: string;
  sponsorCode: string;
  sponsorIfsc: string;
  sponsorAccount: string;
  settlementOffsetDays: number;
  nachEnabled: boolean;
  apbsEnabled: boolean;
} & Record<string, unknown>;

type DscConfig = {
  subjectCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256Fingerprint: string;
} & Record<string, unknown>;

async function getRuns(): Promise<LoaderResult<RunRow[]>> {
  return fetchJson<unknown, RunRow[]>("/api/v1/payroll/runs", [], {
    telemetryKey: "payroll.disbursement.runs",
    mapResponse: (p) => (Array.isArray(p) ? (p as RunRow[]) : null),
  });
}

async function getSponsorConfig(): Promise<LoaderResult<SponsorConfig | null>> {
  return fetchJson<unknown, SponsorConfig | null>("/api/v1/payroll/sponsor-bank-config", null, {
    telemetryKey: "payroll.disbursement.sponsorConfig",
    mapResponse: (p) => {
      if (p == null) return null;
      const obj = p as Record<string, unknown>;
      if (typeof obj.sponsorCode !== "string") return null;
      return obj as SponsorConfig;
    },
  });
}

async function getDscConfig(): Promise<LoaderResult<DscConfig | null>> {
  return fetchJson<unknown, DscConfig | null>("/api/v1/payroll/dsc-config", null, {
    telemetryKey: "payroll.disbursement.dscConfig",
    mapResponse: (p) => {
      if (p == null) return null;
      const arr = (p as { data?: DscConfig })?.data;
      return arr ?? null;
    },
  });
}

export default async function DisbursementPage() {
  const [runsResult, sponsorResult, dscResult] = await Promise.all([
    getRuns(),
    getSponsorConfig(),
    getDscConfig(),
  ]);

  const runs = runsResult.data;
  const eligibleRuns = runs.filter((r) => r.status === "completed" || r.status === "paid");
  const sponsorConfig = sponsorResult.data;
  const dscConfig = dscResult.data;

  const anyError = runsResult.source === "error" || sponsorResult.source === "error" || dscResult.source === "error";

  // NOTE: PayrollRunDetailSchema's grossAmount/netAmount are already RUPEES
  // (payroll-service's listRuns() divides totalNetMinor by 100 before returning),
  // unlike every *Minor field elsewhere in the payroll API. DataTable's
  // cellType:"amount" calls formatMoney(), which treats its input as MINOR
  // units and divides by 100 again — that would render this run's net pay
  // 100x too small on the exact screen used to confirm a bank transfer, so we
  // deliberately do NOT use cellType:"amount" here. Format as rupees directly.
  const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  type RunDisplayRow = RunRow & { netAmountDisplay: string };
  const runRows: RunDisplayRow[] = runs.map((r) => ({
    ...r,
    netAmountDisplay: inrFormatter.format(r.netAmount),
  }));

  const runColumns: { key: keyof RunDisplayRow & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "payPeriod", label: "Pay Period" },
    { key: "employeeCount", label: "Employees", align: "right" },
    { key: "netAmountDisplay", label: "Net Amount", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Disbursement & Settlement"
        subtitle="Bank transfer files, NACH mandates, NACH returns, sponsor bank and DSC configuration."
        back="/hr/payroll"
      />
      {anyError && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="🏦" iconBg="#e6f0ff" label="Runs Ready for Disbursement" value={eligibleRuns.length} />
        <StatCard
          icon="🔐"
          iconBg="#fffbe6"
          label="Sponsor Bank Config"
          value={sponsorConfig ? "Configured" : "Not configured"}
        />
        <StatCard icon="✍️" iconBg="#e6f7f0" label="DSC Status" value={dscConfig ? "Active" : "Not configured"} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total Payroll Runs" value={runs.length} />
      </StatGrid>

      <Card title="Payroll Runs">
        <DataTable<RunDisplayRow>
          columns={runColumns}
          rows={runRows}
          sortable
          filterable
          filterPlaceholder="Filter by pay period…"
          pageSize={10}
          emptyIcon="🏦"
          emptyTitle="No payroll runs yet"
          emptyMessage="Runs will appear here once payroll processing has started."
        />
      </Card>

      <Card title="Generate Bank Transfer File">
        {eligibleRuns.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="No runs ready for a bank file"
            message="A bank transfer file can only be generated for a run that is approved or disbursed. Approve a run under Payroll Runs first."
          />
        ) : (
          <BankFileForm runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod, netAmount: r.netAmount }))} />
        )}
      </Card>

      <Card title="NACH Mandates">
        <NachMandateForm />
        <EmptyState
          icon="📋"
          title="No active mandates"
          message="Registered NACH mandates will appear here. Use the submit form above to register a new mandate, or look up an existing one by reference number."
        />
      </Card>

      <Card title="NACH Return File">
        {eligibleRuns.length === 0 ? (
          <EmptyState
            icon="↩️"
            title="No runs to reconcile"
            message="A NACH return file can be processed against an approved or disbursed run."
          />
        ) : (
          <NachReturnForm runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod }))} />
        )}
      </Card>

      <Card title="Sponsor Bank Configuration">
        <SponsorBankConfigForm initial={sponsorConfig} />
      </Card>

      <Card title="Digital Signature Certificate (DSC)">
        <DscConfigForm initial={dscConfig} />
      </Card>
    </main>
  );
}
