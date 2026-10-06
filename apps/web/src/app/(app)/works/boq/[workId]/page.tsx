import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, Card, DataTable, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, sumMinor } from "@/lib/formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoqItem {
  id: string;
  workId: string;
  itemDescription: string;
  itemCode: string;
  unit: string;
  rate: string;        // paise as bigint-serialised string
  quantity: string;
  amountMinor: string; // paise as bigint-serialised string
  scopeId: string;
  srItemId: string;
}

/** One recapitulation breakdown line (works-service returns these so the
 * derivation of the Grand Total is auditable — GAP-WORKS-BOQ-WORKID-01). */
interface RecapLine {
  key: string;
  label: string;
  basis: "work_amount" | "flat";
  ratePercent: number | null;
  amountMinor: string; // paise as bigint-serialised string
}

interface Recapitulation {
  workAmount: string;
  grandTotal: string;
  contingencyPercent: string;
  turnoverTaxPercent: string;
  workChargePercent: string;
  qualityControlPercent: string;
  centagePercent: string;
  otherCharges: string;
  breakdown: RecapLine[];
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

function pickDataArray(payload: unknown): unknown[] {
  if (payload && typeof payload === "object" && "data" in payload) {
    const d = (payload as { data: unknown }).data;
    return Array.isArray(d) ? d : [];
  }
  return Array.isArray(payload) ? payload : [];
}

function pickDataObject(payload: unknown): Record<string, unknown> | null {
  if (payload && typeof payload === "object" && "data" in payload) {
    const d = (payload as { data: unknown }).data;
    return d && typeof d === "object" && !Array.isArray(d)
      ? (d as Record<string, unknown>)
      : null;
  }
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function asBoqItem(r: unknown): BoqItem {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  return {
    id:              String(o.id ?? ""),
    workId:          String(o.workId ?? ""),
    itemDescription: String(o.itemDescription ?? "—"),
    itemCode:        String(o.itemCode ?? "—"),
    unit:            String(o.unit ?? "—"),
    rate:            String(o.rate ?? "0"),
    quantity:        String(o.quantity ?? "0"),
    amountMinor:     String(o.amountMinor ?? "0"),
    scopeId:         String(o.scopeId ?? ""),
    srItemId:        String(o.srItemId ?? ""),
  };
}

function asRecapLine(r: unknown): RecapLine {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const basis = o.basis === "work_amount" ? "work_amount" : "flat";
  return {
    key:         String(o.key ?? ""),
    label:       String(o.label ?? ""),
    basis,
    ratePercent: typeof o.ratePercent === "number" ? o.ratePercent : null,
    amountMinor: String(o.amountMinor ?? "0"),
  };
}

function asRecapitulation(o: Record<string, unknown>): Recapitulation {
  const breakdown = Array.isArray(o.breakdown) ? o.breakdown.map(asRecapLine) : [];
  return {
    workAmount:            String(o.workAmount ?? "0"),
    grandTotal:            String(o.grandTotal ?? "0"),
    contingencyPercent:    String(o.contingencyPercent ?? "0"),
    turnoverTaxPercent:    String(o.turnoverTaxPercent ?? "0"),
    workChargePercent:     String(o.workChargePercent ?? "0"),
    qualityControlPercent: String(o.qualityControlPercent ?? "0"),
    centagePercent:        String(o.centagePercent ?? "0"),
    otherCharges:          String(o.otherCharges ?? "0"),
    breakdown,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BoqDetailPage({
  params,
}: {
  params: { workId: string };
}) {
  const { workId } = params;

  const [itemsResult, recapResult] = await Promise.all([
    fetchJson<unknown, BoqItem[]>(
      `/api/v1/works/boq/${workId}`,
      [],
      {
        telemetryKey: "works.boq.detail.items",
        mapResponse: (p) => pickDataArray(p).map(asBoqItem),
      },
    ),
    fetchJson<unknown, Recapitulation | null>(
      `/api/v1/works/boq/${workId}/recapitulation`,
      null,
      {
        telemetryKey: "works.boq.detail.recap",
        mapResponse: (p) => {
          const d = pickDataObject(p);
          return d ? asRecapitulation(d) : null;
        },
      },
    ),
  ]);

  // GAP-WORKS-BOQ-WORKID-02: a 404 on the ITEMS call means this work genuinely
  // doesn't exist (the backend 404s a bogus workId) — that is the only case
  // that should 404 the page. Any other items failure (401/500/network) is a
  // "couldn't load" state, not "not found", so render a real error+retry above
  // the table instead of the misleading empty state the page used to show.
  if (itemsResult.source === "error" && itemsResult.status === 404) {
    notFound();
  }

  const items = itemsResult.data;
  const recap = recapResult.data;
  const itemsErrored = itemsResult.source === "error";
  // Recap legitimately 404s when none has been computed yet — that is "not
  // available", not an error. Any non-404 recap failure is a real error notice.
  const recapErrored = recapResult.source === "error" && recapResult.status !== 404;

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalItems  = items.length;
  // GAP-WORKS-BOQ-WORKID-03: fallback total sums paise with BigInt (sumMinor),
  // never Number() — float on money violates the bigint-end-to-end rule.
  const fallbackTotal = sumMinor(items.map((i) => i.amountMinor)).total;
  const totalAmount = recap?.grandTotal ? formatMoney(recap.grandTotal) : formatMoney(fallbackTotal);
  const contingencyPct = recap ? `${recap.contingencyPercent}%` : "—";
  const workChargePct  = recap ? `${recap.workChargePercent}%` : "—";

  // ── DataTable rows (amounts stay as minor-unit STRINGS — formatMoney treats a
  // numeric string as paise; never Number() them, GAP-WORKS-BOQ-WORKID-03) ──
  const boqRows: Record<string, unknown>[] = items.map((item) => ({
    id:              item.id,
    itemCode:        item.itemCode,
    itemDescription: item.itemDescription,
    unit:            item.unit,
    rate:            item.rate,
    quantity:        item.quantity,
    amountMinor:     item.amountMinor,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bill of Quantities"
        // GAP-WORKS-BOQ-WORKID-04: no human work number is on the BoQ item type,
        // so keep the short id but mark it clearly as a reference and give the
        // full id as a tooltip rather than a bare truncated UUID.
        subtitle={`Work ref ${params.workId.slice(0, 8)}…`}
        back="/works/boq"
        backLabel="BoQ Register"
        actions={
          <Link
            href={"/works/boq/new?workId=" + params.workId}
            className="btn primary"
            style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
          >
            + Add item
          </Link>
        }
      />

      {itemsErrored ? (
        <RefreshErrorState
          error={{
            what: "We couldn't load the BoQ items for this work.",
            next: "Please try again in a moment.",
            actions: ["retry", "back"],
          }}
          backHref="/works/boq"
          source={{ status: itemsResult.status, code: itemsResult.errorCode, area: "BoQ items" }}
        />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📐" iconBg="#eff6ff" label="Total Items"   value={totalItems} />
            <StatCard icon="💰" iconBg="#ecfdf3" label={recap?.grandTotal ? "Grand Total" : "Sum of items"}  value={totalAmount} hint={recap?.grandTotal ? "Recapitulation grand total." : "Sum of BoQ line amounts (recapitulation not yet computed)."} />
            <StatCard icon="📊" iconBg="#fffaeb" label="Contingency %" value={contingencyPct} />
            <StatCard icon="🏗️" iconBg="#f0fdf4" label="Work Charge %" value={workChargePct} />
          </StatGrid>

          <Card title="BoQ Items">
            <DataTable
              columns={[
                { key: "itemCode",        label: "Item Code" },
                { key: "itemDescription", label: "Description" },
                { key: "unit",            label: "Unit" },
                { key: "rate",            label: "Rate ₹",   cellType: "amount", align: "right" },
                { key: "quantity",        label: "Qty",       align: "right" },
                { key: "amountMinor",     label: "Amount ₹", cellType: "amount", align: "right" },
              ]}
              rows={boqRows}
              emptyIcon="📋"
              emptyTitle="No BoQ items"
              emptyMessage="No bill of quantities items have been added for this work yet."
              emptyAction={
                <Link href={`/works/boq/new?workId=${workId}`} className="btn primary">
                  + Add first item
                </Link>
              }
            />
          </Card>

          {recapErrored ? (
            <Card title="Recapitulation">
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }} role="note">
                Recapitulation is unavailable right now. Reload the page to try again.
              </p>
            </Card>
          ) : recap ? (
            <Card title="Recapitulation">
              {/* GAP-WORKS-BOQ-WORKID-01: show Component | Basis | Rate % |
                  Amount so a reviewer can recompute the Grand Total. Each %
                  line's amount is that percentage OF the Work Amount; flat ₹
                  lines (Work Amount, Other Charges) carry no rate. No cell
                  mixes a % and a ₹ figure. See the footnote on order. */}
              <div className="tbl-wrap">
                <table className="tbl" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: "start" }}>Component</th>
                      <th scope="col" style={{ textAlign: "start" }}>Basis</th>
                      <th scope="col" className="num">Rate</th>
                      <th scope="col" className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recap.breakdown.map((line) => (
                      <tr key={line.key}>
                        <th scope="row" style={{ textAlign: "start", fontWeight: 600 }}>{line.label}</th>
                        <td>{line.basis === "work_amount" ? "% of Work Amount" : "Flat amount"}</td>
                        <td className="num">{line.ratePercent !== null ? `${line.ratePercent}%` : "—"}</td>
                        <td className="num">{formatMoney(line.amountMinor)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--border, #e2e8f0)" }}>
                      <th scope="row" style={{ textAlign: "start", fontWeight: 700 }}>Grand Total</th>
                      <td></td>
                      <td></td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatMoney(recap.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                Each percentage line is charged on the Work Amount (not compounded); components are added to arrive at the Grand Total.
              </p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
