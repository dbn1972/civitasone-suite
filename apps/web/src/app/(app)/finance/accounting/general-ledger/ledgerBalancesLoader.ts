import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapLedgerBalances, type LedgerBalances } from "./ledgerBalances";

/** fx-p3: GET /v1/finance/ledger/balances?headId=<uuid or code>&fy=YYYY-YY (see ledgerBalances.ts). */
export async function getLedgerBalances(head: string, fy: string): Promise<LoaderResult<LedgerBalances | null>> {
  const qs = `headId=${encodeURIComponent(head)}&fy=${encodeURIComponent(fy)}`;
  return fetchJson<unknown, LedgerBalances | null>(`/api/v1/finance/ledger/balances?${qs}`, null, {
    revalidateSeconds: 0,
    telemetryKey: "finance.ledger.balances",
    mapResponse: mapLedgerBalances,
  });
}
