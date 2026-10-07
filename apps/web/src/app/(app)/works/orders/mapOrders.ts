// Pure mapper for the work-orders list. Kept out of page.tsx because a Next.js
// page module may only export the page/route-config fields.

type RawOrder = {
  id: string;
  workNumber?: string;
  description?: string;
  status?: string;
  category?: string;
  estimatedCostMinor?: number | bigint | string;
  createdAt?: string;
} & Record<string, unknown>;

export type OrderRow = {
  id: string;
  workNumber: string;
  description: string;
  /** Raw backend status token (e.g. "dao_finalized"); StatusPill humanizes it. */
  status: string;
  category: string;
  /** Estimated cost in MINOR units (paise) as a string — formatted paise-exact by DataTable. */
  estimatedCost: string;
};

// Sort priority only. Display labels/tones are owned by the shared
// StatusPill/humanizeStatus (GAP-WORKS-ORDERS-03) so /works/orders,
// /works/proposals and the detail page never disagree.
const STATUS_PRIORITY: Record<string, number> = {
  draft: 1,
  dao_finalized: 2,
  ts_eligible: 3,
  active: 4,
  closed: 5,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function mapOrders(payload: unknown): OrderRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  return rows
    .flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const row = raw as RawOrder;
      if (typeof row.id !== "string") return [];
      const status = String(row.status ?? "draft");
      // Keep estimated cost as the raw paise string end-to-end (bigint-safe):
      // Number() here would lose precision above 2^53 and round the display,
      // disagreeing with the paise-exact formatMoney used on proposals.
      const estimatedCost = row.estimatedCostMinor != null ? String(row.estimatedCostMinor) : "0";
      return [{
        id: row.id,
        workNumber: String(row.workNumber ?? row.id.slice(0, 8)),
        description: String(row.description ?? "—").slice(0, 80),
        status,
        category: String(row.category ?? "—"),
        estimatedCost,
        _statusOrder: STATUS_PRIORITY[status] ?? 99,
      }];
    })
    .sort((a, b) => (a as { _statusOrder: number })._statusOrder - (b as { _statusOrder: number })._statusOrder);
}
