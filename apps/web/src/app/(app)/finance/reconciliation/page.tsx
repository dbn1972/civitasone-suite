import { Suspense } from "react";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState, SkeletonBar } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { RunsTable, type RunRow } from "./RunsTable";
import { ExceptionsPanel, type ExceptionRow } from "./ExceptionsPanel";
import { SubledgerSection } from "./SubledgerSection";
import { canActOnExceptions, latestStartedAt } from "./reconHelpers";

type ProviderRow = { key: string; sourceSystem: string; targetSystem: string } & Record<string, unknown>;

async function getRuns(): Promise<LoaderResult<RunRow[]>> {
  return fetchJson<unknown, RunRow[]>("/api/v1/finance/recon/runs", [], {
    telemetryKey: "finance.recon.runs",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RunRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getExceptions(): Promise<LoaderResult<ExceptionRow[]>> {
  return fetchJson<unknown, ExceptionRow[]>("/api/v1/finance/recon/exceptions", [], {
    telemetryKey: "finance.recon.exceptions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ExceptionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getProviders(): Promise<LoaderResult<ProviderRow[]>> {
  return fetchJson<unknown, ProviderRow[]>("/api/v1/finance/recon/providers", [], {
    telemetryKey: "finance.recon.providers",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ProviderRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ReconciliationWorkbenchPage() {
  // The subledger card streams separately (<SubledgerSection> under Suspense),
  // so its two aggregate queries never delay these three.
  const [runsResult, exceptionsResult, providersResult] = await Promise.all([
    getRuns(),
    getExceptions(),
    getProviders(),
  ]);

  const runs = runsResult.data;
  const exceptions = exceptionsResult.data;
  const providers = providersResult.data;
  const anyError = [runsResult.source, exceptionsResult.source, providersResult.source].includes("error");
  const canAct = canActOnExceptions(getSessionRoles());
  // Newest run by date, not runs[0]: the API order is not a contract (GAP-FINANCE-RECONCILIATION-07).
  const lastRunStartedAt = latestStartedAt(runs);

  const openExceptions = exceptions.filter((e) => e.status === "open" || e.status === "investigating").length;
  const unbalancedRuns = runs.filter((r) => !r.balanced).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Reconciliation Workbench"
        subtitle="Review reconciliation runs, triage breaks, and confirm subledger↔GL agreement."
        back="/finance"
        actions={anyError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🔁" iconBg="#e7edfd" label="Recon Runs" value={runsResult.source === "error" ? "—" : runs.length} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Unbalanced Runs" value={runsResult.source === "error" ? "—" : unbalancedRuns} />
        <StatCard icon="🧩" iconBg="#fffaeb" label="Open Exceptions" value={exceptionsResult.source === "error" ? "—" : openExceptions} />
        <StatCard icon="🔌" iconBg="#eff6ff" label="Providers" value={providersResult.source === "error" ? "—" : providers.length} />
      </StatGrid>

      <Card title="Reconciliation Runs">
        {runsResult.source === "error" && runs.length === 0 ? (
          <LoadErrorState result={runsResult} area="reconciliation runs" backHref="/finance" />
        ) : (
          <RunsTable runs={runs} />
        )}
      </Card>

      <Card title="Exceptions">
        {exceptionsResult.source === "error" && exceptions.length === 0 ? (
          <LoadErrorState result={exceptionsResult} area="reconciliation exceptions" backHref="/finance" />
        ) : (
          <ExceptionsPanel exceptions={exceptions} canAct={canAct} />
        )}
      </Card>

      <Card title="Subledger ↔ GL Reconciliation">
        <Suspense fallback={<SkeletonBar h={120} />}>
          <SubledgerSection />
        </Suspense>
      </Card>

      <Card title="Providers">
        {providersResult.source === "error" ? (
          <LoadErrorState result={providersResult} area="reconciliation providers" backHref="/finance" />
        ) : providers.length === 0 ? (
          <p style={{ color: "var(--ink2)", fontSize: 13 }}>No reconciliation providers registered.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
            {providers.map((p) => (
              <li key={p.key}>
                <span className="mono">{p.key}</span> — {p.sourceSystem} ↔ {p.targetSystem}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {lastRunStartedAt && (
        <p style={{ marginTop: 16, color: "var(--ink2)", fontSize: 12 }}>
          Last run started {formatIndianDate(lastRunStartedAt)}.
        </p>
      )}
    </div>
  );
}
