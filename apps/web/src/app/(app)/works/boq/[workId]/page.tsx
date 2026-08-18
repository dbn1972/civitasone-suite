import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";

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

interface Recapitulation {
  workAmount: string;
  grandTotal: string;
  contingencyPercent: string;
  turnoverTaxPercent: string;
  workChargePercent: string;
  qualityControlPercent: string;
  centagePercent: string;
  otherCharges: string;
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

function asRecapitulation(o: Record<string, unknown>): Recapitulation {
  return {
    workAmount:            String(o.workAmount ?? "0"),
    grandTotal:            String(o.grandTotal ?? "0"),
    contingencyPercent:    String(o.contingencyPercent ?? "0"),
    turnoverTaxPercent:    String(o.turnoverTaxPercent ?? "0"),
    workChargePercent:     String(o.workChargePercent ?? "0"),
    qualityControlPercent: String(o.qualityControlPercent ?? "0"),
    centagePercent:        String(o.centagePercent ?? "0"),
    otherCharges:          String(o.otherCharges ?? "0"),
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

  if (itemsResult.source === "error" && recapResult.source === "error") {
    notFound();
  }

  const items = itemsResult.data;
  const recap = recapResult.data;

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalItems  = items.length;
  const totalAmount = recap?.grandTotal
    ? formatMoney(recap.grandTotal)
    : formatMoney(items.reduce((sum, i) => sum + Number(i.amountMinor), 0));
  const contingencyPct = recap ? `${recap.contingencyPercent}%` : "—";
  const workChargePct  = recap ? `${recap.workChargePercent}%` : "—";

  // ── DataTable rows (amounts as numbers in paise — formatMoney treats numbers as minor units) ──
  const boqRows: Record<string, unknown>[] = items.map((item) => ({
    id:              item.id,
    itemCode:        item.itemCode,
    itemDescription: item.itemDescription,
    unit:            item.unit,
    rate:            Number(item.rate),
    quantity:        item.quantity,
    amountMinor:     Number(item.amountMinor),
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bill of Quantities"
        subtitle={`Work ${params.workId.slice(0, 8)}…`}
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

      <StatGrid>
        <StatCard icon="📐" iconBg="#eff6ff" label="Total Items"   value={totalItems} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Amount"  value={totalAmount} />
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
        />
      </Card>

      {recap && (
        <Card title="Recapitulation">
          <div className="tbl-wrap">
            <table className="tbl" style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Work Amount</th>
                  <td className="num">{formatMoney(recap.workAmount)}</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Contingency</th>
                  <td className="num">{recap.contingencyPercent}%</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Turnover Tax</th>
                  <td className="num">{recap.turnoverTaxPercent}%</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Work Charge</th>
                  <td className="num">{recap.workChargePercent}%</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Quality Control</th>
                  <td className="num">{recap.qualityControlPercent}%</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Centage</th>
                  <td className="num">{recap.centagePercent}%</td>
                </tr>
                <tr>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 600 }}>Other Charges</th>
                  <td className="num">{formatMoney(recap.otherCharges)}</td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--border, #e2e8f0)" }}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 700 }}>Grand Total</th>
                  <td className="num" style={{ fontWeight: 700 }}>{formatMoney(recap.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
