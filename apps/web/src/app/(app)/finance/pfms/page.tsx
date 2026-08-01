import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PfmsConsole } from "./PfmsConsole";
import type { PfmsBatchRow, PfmsConfig } from "./types";

async function getBatches(): Promise<LoaderResult<PfmsBatchRow[]>> {
  return fetchJson<unknown, PfmsBatchRow[]>("/api/v1/finance/pfms/batches", [], {
    telemetryKey: "finance.pfms.batches",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PfmsBatchRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getConfig(): Promise<LoaderResult<PfmsConfig | null>> {
  return fetchJson<unknown, PfmsConfig | null>("/api/v1/finance/pfms/config", null, {
    telemetryKey: "finance.pfms.config",
    mapResponse: (p) => (p && typeof p === "object" ? (p as PfmsConfig) : null),
  });
}

export default async function PfmsOpsConsolePage() {
  const [{ data: batches, source: batchesSource }, { data: config, source: configSource }] =
    await Promise.all([getBatches(), getConfig()]);

  const source = batchesSource === "error" || configSource === "error" ? "error" : "api";

  const signedCount = batches.filter((b) => b.submissionStatus === "signed").length;
  const pendingCount = batches.filter((b) => b.submissionStatus === "pending").length;
  const totalMinor = batches.reduce((sum, b) => sum + BigInt(b.amountMinor || "0"), 0n);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="PFMS Ops Console"
        subtitle="Operational console for PFMS batches, tenant configuration, salary bills, payment advices, and e-Kuber payment submission."
        back="/finance"
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="📦" iconBg="#eff6ff" label="PFMS Batches" value={batches.length} />
        <StatCard icon="✍️" iconBg="#ecfdf3" label="Signed" value={signedCount} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Signature" value={pendingCount} />
        <StatCard
          icon="💰"
          iconBg="#fef3f2"
          label="Total Batch Value"
          // Money formatting: amountMinor is paise (minor units) — use formatMoney,
          // not formatRupees.
          value={formatMoney(totalMinor)}
        />
      </StatGrid>

      <PfmsConsole batches={batches} config={config} />
    </main>
  );
}
