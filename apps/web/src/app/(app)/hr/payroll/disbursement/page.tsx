import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { BankFileWizard, type DscConfig } from "./BankFileWizard";
import { NachMandateForm } from "./NachMandateForm";
import { NachReturnForm } from "./NachReturnForm";
import { SponsorBankConfigForm } from "./SponsorBankConfigForm";
import { DscConfigForm } from "./DscConfigForm";
import { DisbursementTransferTable, type TransferRow } from "./DisbursementTransferTable";

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

type RawDscConfig = {
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

async function getDscConfig(): Promise<LoaderResult<RawDscConfig | null>> {
  return fetchJson<unknown, RawDscConfig | null>("/api/v1/payroll/dsc-config", null, {
    telemetryKey: "payroll.disbursement.dscConfig",
    mapResponse: (p) => {
      if (p == null) return null;
      const arr = (p as { data?: RawDscConfig })?.data;
      return arr ?? null;
    },
  });
}

async function getTransfers(): Promise<LoaderResult<TransferRow[]>> {
  return fetchJson<unknown, TransferRow[]>("/api/v1/payroll/disbursement/transfers", [], {
    telemetryKey: "payroll.disbursement.transfers",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
      return Array.isArray(arr) ? (arr as TransferRow[]) : null;
    },
  });
}

export default async function DisbursementPage() {
  const [runsResult, sponsorResult, dscResult, transfersResult] = await Promise.all([
    getRuns(),
    getSponsorConfig(),
    getDscConfig(),
    getTransfers(),
  ]);

  const runs = runsResult.data;
  const eligibleRuns = runs.filter((r) => r.status === "completed" || r.status === "paid");
  const sponsorConfig = sponsorResult.data;
  const rawDsc = dscResult.data;
  const transfers = transfersResult.data;

  // Shape DscConfig to the type BankFileWizard expects
  const dscConfig: DscConfig = rawDsc
    ? { subjectCn: rawDsc.subjectCn, notAfter: rawDsc.notAfter, sha256Fingerprint: rawDsc.sha256Fingerprint }
    : null;

  const anyError =
    runsResult.source === "error" ||
    sponsorResult.source === "error" ||
    dscResult.source === "error";

  // NOTE: PayrollRunDetailSchema's grossAmount/netAmount are already RUPEES.
  // Do NOT use cellType:"amount" here (that would divide by 100 again).
  const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  const credited = transfers.filter((t) => t.status === "credited").length;
  const failed = transfers.filter((t) => t.status === "failed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Disbursement & Settlement"
        subtitle="Employee bank transfers, NACH mandates, bank file generation, DSC signing."
        back="/hr/payroll"
      />
      {anyError && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--infobg)" label="Runs Ready for Disbursement" value={eligibleRuns.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Transfers Credited" value={credited} />
        <StatCard icon="⚠️" iconBg={failed > 0 ? "var(--badbg)" : "var(--line2)"} label="Transfers Failed" value={failed} />
        <StatCard
          icon="🔐"
          iconBg="var(--warnbg)"
          label="DSC Status"
          value={dscConfig ? "Active" : "Not configured"}
        />
      </StatGrid>

      {/* Employee bank transfer dashboard */}
      <Card title="Employee Bank Transfers">
        <DisbursementTransferTable transfers={transfers} />
      </Card>

      {/* Bank file generation wizard */}
      <Card title="Generate Bank Transfer File">
        <BankFileWizard
          runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod, netAmount: r.netAmount }))}
          dscConfig={dscConfig}
        />
      </Card>

      <Card title="NACH Mandates">
        <NachMandateForm />
        <EmptyState
          icon="📋"
          title="No active mandates"
          message="Registered NACH mandates will appear here. Use the submit form above to register a new mandate."
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
        <DscConfigForm initial={rawDsc} />
      </Card>
    </main>
  );
}
