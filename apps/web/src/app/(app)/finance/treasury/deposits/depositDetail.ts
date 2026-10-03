import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GAP-FINANCE-TREASURY-DEPOSITS-03: one deposit with its ledger of events
 * (GET /v1/finance/deposits/:id). Money is bigint paise, carried as strings.
 */
export type DepositEvent = {
  id: string;
  eventType: string;
  amountMinor: string;
  reference: string | null;
  journalId: string | null;
  createdAt: string;
};

export type DepositDetail = {
  id: string;
  pdNo: string;
  type: string;
  administrator: string;
  balanceMinor: string;
  currency: string;
  status: string;
  refundedMinor: string;
  forfeitedMinor: string;
  adjustedMinor: string;
  createdAt: string;
  events: DepositEvent[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Maps the `{ data: deposit }` payload; null when it is not a deposit (so a bad payload is an error, not an empty page). */
export function mapDepositDetail(payload: unknown): DepositDetail | null {
  const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!d || typeof d.id !== "string" || typeof d.pdNo !== "string") return null;
  const events = Array.isArray(d.events)
    ? d.events.filter(isRecord).map((e): DepositEvent => ({
        id: str(e.id),
        eventType: str(e.eventType),
        amountMinor: str(e.amountMinor, "0"),
        reference: strOrNull(e.reference),
        journalId: strOrNull(e.journalId),
        createdAt: str(e.createdAt),
      }))
    : [];
  return {
    id: d.id,
    pdNo: d.pdNo,
    type: str(d.type),
    administrator: str(d.administrator),
    balanceMinor: str(d.balanceMinor, "0"),
    currency: str(d.currency, "INR"),
    status: str(d.status),
    refundedMinor: str(d.refundedMinor, "0"),
    forfeitedMinor: str(d.forfeitedMinor, "0"),
    adjustedMinor: str(d.adjustedMinor, "0"),
    createdAt: str(d.createdAt),
    events,
  };
}

export async function getFinanceDepositById(id: string): Promise<LoaderResult<DepositDetail | null>> {
  return fetchJson<unknown, DepositDetail | null>(`/api/v1/finance/deposits/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.deposit.detail",
    mapResponse: mapDepositDetail,
  });
}
