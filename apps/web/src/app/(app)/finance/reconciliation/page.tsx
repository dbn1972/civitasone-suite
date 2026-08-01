import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { RunsTable, type RunRow } from "./RunsTable";
import { ExceptionsPanel, type ExceptionRow } from "./ExceptionsPanel";

type ProviderRow = { key: string; sourceSystem: string; targetSystem: string } & Record<string, unknown>;

type SubledgerRecon = {
  side: "ap" | "ar";
  controlAccountCode: string;
  controlAccountResolved: boolean;
  subledgerBalanceMinor: string;
  controlAccountBalanceMinor: string;
  differenceMinor: string;
  isReconciled: boolean;
};

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

async function getSubledgerRecon(side: "ap" | "ar"): Promise<LoaderResult<SubledgerRecon | null>> {
  return fetchJson<unknown, SubledgerRecon | null>(`/api/v1/finance/subledger-gl-reconciliation?side=${side}`, null, {
    telemetryKey: `finance.recon.subledger.${side}`,
    mapResponse: (p) => {
      const data = (p as { data?: SubledgerRecon })?.data;
      return data ?? null;
    },
  });
}

export default async function ReconciliationWorkbenchPage() {
  const [runsResult, exceptionsResult, providersResult, apResult, arResult] = await Promise.all([
    getRuns(),
    getExceptions(),
    getProviders(),
    getSubledgerRecon("ap"),
    getSubledgerRecon("ar"),
  ]);

  const runs = runsResult.data;
  const exceptions = exceptionsResult.data;
  const providers = providersResult.data;
  const ap = apResult.data;
  const ar = arResult.data;

  const anyError = [runsResult.source, exceptionsResult.source, providersResult.source, apResult.source, arResult.source].includes(
    "error",
  );

  const openExceptions = exceptions.filter((e) => e.status === "open" || e.status === "investigating").length;
  const unbalancedRuns = runs.filter((r) => !r.balanced).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Reconciliation Workbench"
        subtitle="Review reconciliation runs, triage breaks, and confirm subledger↔GL agreement."
        back="/finance"
        actions={anyError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🔁" iconBg="#e7edfd" label="Recon Runs" value={runs.length} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Unbalanced Runs" value={unbalancedRuns} />
        <StatCard icon="🧩" iconBg="#fffaeb" label="Open Exceptions" value={openExceptions} />
        <StatCard icon="🔌" iconBg="#eff6ff" label="Providers" value={providers.length} />
      </StatGrid>

      <Card title="Reconciliation Runs">
        {runsResult.source === "error" && runs.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <RunsTable runs={runs} />
        )}
      </Card>

      <Card title="Exceptions">
        {exceptionsResult.source === "error" && exceptions.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <ExceptionsPanel exceptions={exceptions} />
        )}
      </Card>

      <Card title="Subledger ↔ GL Reconciliation">
        {apResult.source === "error" && ar === null && ap === null ? (
          <DataSourceBadge source="error" />
        ) : (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            {([
              ["AP (Payables)", ap],
              ["AR (Receivables)", ar],
            ] as const).map(([label, recon]) => (
              <div key={label} className="pad" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>{label}</h3>
                {recon === null ? (
                  <p style={{ color: "var(--ink2)", fontSize: 13 }}>No data available.</p>
                ) : (
                  <dl style={{ display: "grid", gap: 6, margin: 0, fontSize: 13.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <dt>Control account</dt>
                      <dd>
                        {recon.controlAccountCode}
                        {!recon.controlAccountResolved ? " (unresolved)" : ""}
                      </dd>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <dt>Subledger balance</dt>
                      <dd className="mono">{formatMoney(recon.subledgerBalanceMinor)}</dd>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <dt>Control (GL) balance</dt>
                      <dd className="mono">{formatMoney(recon.controlAccountBalanceMinor)}</dd>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <dt>Difference</dt>
                      <dd className="mono">{formatMoney(recon.differenceMinor)}</dd>
                    </div>
                    <div>
                      <span className={`pill ${recon.isReconciled ? "good" : "bad"}`}>
                        {recon.isReconciled ? "Reconciled" : "Not reconciled"}
                      </span>
                    </div>
                  </dl>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Providers">
        {providers.length === 0 ? (
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

      {runs.length > 0 && (
        <p style={{ marginTop: 16, color: "var(--ink2)", fontSize: 12 }}>
          Last run started {formatIndianDate(runs[0]?.startedAt)}.
        </p>
      )}
    </main>
  );
}
