import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
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
  const t = await getTranslations("disbursement");
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

  // UX-013: each stat/section below is gated on the specific loader it
  // actually depends on (not one page-wide flag) — a DSC-config outage must
  // not blank out the runs/transfers numbers that loaded fine, and vice
  // versa. `anyError` is kept (now including transfersResult, which the
  // original check omitted) only for the summary badge.
  const runsErrored = runsResult.source === "error";
  const transfersErrored = transfersResult.source === "error";
  const dscErrored = dscResult.source === "error";
  const anyError = runsErrored || sponsorResult.source === "error" || dscErrored || transfersErrored;

  // NOTE: PayrollRunDetailSchema's grossAmount/netAmount are already RUPEES.
  // Do NOT use cellType:"amount" here (that would divide by 100 again).
  const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });

  // UX-017: this page now also holds `t`, the translation function, in
  // scope -- renamed these two filter callbacks' parameter from the more
  // obvious `t` (for "transfer") to `tx` to avoid shadowing it, the exact
  // tranche-7-discovered bug class (see also DisbursementTransferTable.tsx).
  const credited = transfersErrored ? null : transfers.filter((tx) => tx.status === "credited").length;
  const failed = transfersErrored ? null : transfers.filter((tx) => tx.status === "failed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      {anyError && <DataSourceBadge source="error" message={t("loadErrorMessage")} />}

      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--infobg)" label={t("statRunsReady")} value={runsErrored ? "—" : eligibleRuns.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statTransfersCredited")} value={credited ?? "—"} />
        <StatCard icon="⚠️" iconBg={failed && failed > 0 ? "var(--badbg)" : "var(--line2)"} label={t("statTransfersFailed")} value={failed ?? "—"} />
        <StatCard
          icon="🔐"
          iconBg="var(--warnbg)"
          label={t("statDscStatus")}
          value={dscErrored ? "—" : dscConfig ? t("dscActive") : t("dscNotConfigured")}
        />
      </StatGrid>

      {/* Employee bank transfer dashboard */}
      <Card title={t("transfersCardTitle")}>
        <DisbursementTransferTable transfers={transfers} />
      </Card>

      {/* Bank file generation wizard */}
      <Card title={t("bankFileCardTitle")}>
        <BankFileWizard
          runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod, netAmount: r.netAmount }))}
          dscConfig={dscConfig}
        />
      </Card>

      <Card title={t("nachMandatesCardTitle")}>
        <NachMandateForm />
        <EmptyState
          icon="📋"
          title={t("mandateEmptyTitle")}
          message={t("mandateEmptyMessage")}
        />
      </Card>

      <Card title={t("nachReturnCardTitle")}>
        {runsErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr/payroll" />
          </div>
        ) : eligibleRuns.length === 0 ? (
          <EmptyState
            icon="↩️"
            title={t("nachReturnEmptyTitle")}
            message={t("nachReturnEmptyMessage")}
          />
        ) : (
          <NachReturnForm runs={eligibleRuns.map((r) => ({ id: r.id, payPeriod: r.payPeriod }))} />
        )}
      </Card>

      <Card title={t("sponsorConfigCardTitle")}>
        <SponsorBankConfigForm initial={sponsorConfig} />
      </Card>

      <Card title={t("dscCardTitle")}>
        <DscConfigForm initial={rawDsc} />
      </Card>
    </main>
  );
}
