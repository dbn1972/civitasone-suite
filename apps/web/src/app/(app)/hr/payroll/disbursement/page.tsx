import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
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

  const runColumns: { key: keyof RunRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "payPeriod", label: "Pay Period" },
    { key: "employeeCount", label: "Employees", align: "right" },
    { key: "netAmount", label: "Net Amount", align: "right", cellType: "amount" },
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
      </StatGrid>

      <Card title="Payroll Runs">
        <DataTable<RunRow>
          columns={runColumns}
          rows={runs}
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
          title="Mandate list not yet available"
          message="The payroll-service does not currently expose a GET /v1/payroll/nach/mandates listing endpoint — only mandate submission (POST) and single-reference status lookup (GET .../:ref/status) exist. This screen submits a mandate or looks up one reference at a time; no mandate list is fabricated here."
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
