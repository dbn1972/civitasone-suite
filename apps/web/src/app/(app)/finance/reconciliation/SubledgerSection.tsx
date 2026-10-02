import { StatusPill } from "@/app/_components/ds";
import { LoadErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

type SubledgerRecon = {
  side: "ap" | "ar";
  controlAccountCode: string;
  controlAccountResolved: boolean;
  subledgerBalanceMinor: string;
  controlAccountBalanceMinor: string;
  differenceMinor: string;
  isReconciled: boolean;
};

async function getSubledgerRecon(side: "ap" | "ar"): Promise<LoaderResult<SubledgerRecon | null>> {
  return fetchJson<unknown, SubledgerRecon | null>(`/api/v1/finance/subledger-gl-reconciliation?side=${side}`, null, {
    telemetryKey: `finance.recon.subledger.${side}`,
    mapResponse: (p) => {
      const data = (p as { data?: SubledgerRecon })?.data;
      return data ?? null;
    },
  });
}

/**
 * Subledger <-> GL card. Its own async server component so the page can stream
 * it behind <Suspense>: two aggregate subledger queries no longer hold up the
 * runs/exceptions tables (GAP-FINANCE-RECONCILIATION-06). A failed side shows
 * its own error state with a working Retry instead of a generic badge.
 */
export async function SubledgerSection() {
  const [apResult, arResult] = await Promise.all([getSubledgerRecon("ap"), getSubledgerRecon("ar")]);
  const sides = [
    ["AP (Payables)", apResult],
    ["AR (Receivables)", arResult],
  ] as const;
  return (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            {sides.map(([label, result]) => {
              const recon = result.data;
              return (
              <div key={label} className="pad" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>{label}</h4>
                {recon === null ? (
                  result.source === "error" ? (
                    <LoadErrorState result={result} area="subledger reconciliation" backHref="/finance" />
                  ) : (
                    <p style={{ color: "var(--ink2)", fontSize: 13 }}>No data available.</p>
                  )
                ) : (
                  // definition-list: a <dl>'s only valid direct children are
                  // dt/dd (optionally grouped in <div>s that each contain a
                  // dt+dd pair), plus <script>/<template>. The StatusPill row
                  // below is neither a term nor a description, so it moved
                  // outside the <dl> as a sibling instead. UX-005 tranche 5.
                  <>
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
                    </dl>
                    <div style={{ marginTop: 6 }}>
                      <StatusPill status={recon.isReconciled ? "cleared" : "breached"} label={recon.isReconciled ? "Reconciled" : "Not reconciled"} />
                    </div>
                  </>
                )}
              </div>
              );
            })}
          </div>
  );
}

