"use client";

import { StatusPill } from "../../../../_components/ds";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";
import type { RFQDetail } from "@civitasone/types";

type Resp = RFQDetail["responses"][number];
type LineItem = RFQDetail["lineItems"][number];

/**
 * GAP-PROCUREMENT-RFQ-DETAIL-02: a limited-tender selection has to be
 * justifiable on file — the officer needs the lowest bidder (L1) marked, the
 * quotes sorted so the comparison is obvious, and (where the backend exposes
 * per-line rates) a vendor × item rate matrix. Amounts are only present once
 * the RFQ is unsealed (closed/past closing); while sealed, this shows the
 * sealed state instead of fabricating ₹0.
 *
 * L1 is the lowest `totalAmountMinor` among responses that are still in the running
 * (not withdrawn/rejected). Compared in integer paise (BigInt) so float
 * rounding can never pick the wrong winner.
 */

function toPaise(minor: string | undefined): bigint | null {
  if (minor === undefined || !/^\d+$/.test(minor)) return null;
  return BigInt(minor);
}

/** The L1 response (lowest total among in-the-running, unsealed responses), or null. */
export function computeL1(responses: Resp[]): Resp | null {
  let best: Resp | null = null;
  let bestPaise: bigint | null = null;
  for (const r of responses) {
    if (r.status === "rejected" || r.status === "withdrawn") continue;
    const p = toPaise(r.totalAmountMinor);
    if (p === null) continue;
    if (bestPaise === null || p < bestPaise) {
      bestPaise = p;
      best = r;
    }
  }
  return best;
}

export function ComparativeStatement({
  responses,
  lineItems,
}: {
  responses: Resp[];
  lineItems: LineItem[];
}) {
  const sealed = responses.length > 0 && responses.every((r) => r.sealed);
  const l1 = computeL1(responses);

  // Ascending by amount; sealed/absent amounts sort last.
  const sorted = [...responses].sort((a, b) => {
    const pa = toPaise(a.totalAmountMinor);
    const pb = toPaise(b.totalAmountMinor);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  // Per-line rate matrix is only meaningful once rates are unsealed and the
  // backend actually carried them.
  const hasRates = !sealed && responses.some((r) => r.lineRates.length > 0);

  function rateFor(resp: Resp, item: LineItem): string | undefined {
    const byId = item.itemId ? resp.lineRates.find((lr) => lr.itemId === item.itemId) : undefined;
    const match = byId ?? resp.lineRates.find((lr) => lr.itemName && lr.itemName === item.itemName);
    return match?.unitPriceMinor;
  }

  return (
    <>
      <table className="tbl" style={{ width: "100%" }}>
        <caption className="sr-only">Comparative statement of vendor quotes</caption>
        <thead>
          <tr>
            <th>Vendor</th>
            <th style={{ textAlign: "end" }}>Bid Amount</th>
            <th>Submitted</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isL1 = l1 != null && r.vendorId === l1.vendorId && !r.sealed;
            return (
              <tr key={r.vendorId}>
                <td data-label="Vendor">
                  {r.vendorName}
                  {isL1 ? (
                    <StatusPill status="good" label="L1" />
                  ) : null}
                </td>
                <td data-label="Bid Amount" style={{ textAlign: "end" }}>
                  {r.sealed ? <StatusPill status="mut" label="Sealed" /> : formatMoney(r.totalAmountMinor)}
                </td>
                <td data-label="Submitted">{formatIndianDateTime(r.submittedAt)}</td>
                <td data-label="Status"><StatusPill status={r.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {hasRates ? (
        <div style={{ marginTop: 16, overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <caption className="sr-only">Per-line rate comparison by vendor</caption>
            <thead>
              <tr>
                <th>Item</th>
                {sorted.map((r) => (
                  <th key={r.vendorId} style={{ textAlign: "end" }}>{r.vendorName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, idx) => (
                <tr key={item.itemId ?? `${item.itemName}-${idx}`}>
                  <td data-label="Item">{item.itemName}</td>
                  {sorted.map((r) => {
                    const rate = rateFor(r, item);
                    return (
                      <td key={r.vendorId} style={{ textAlign: "end" }}>
                        {rate === undefined ? "—" : formatMoney(rate)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
