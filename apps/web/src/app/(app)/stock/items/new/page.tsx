"use client";

/**
 * New Stock Item.
 *
 * Wires to the canonical create endpoint POST /v1/stock/items via the gateway
 * proxy (stock-service already exposes the command + consumer). The form is a
 * real action with validation + accessible error reporting (aria-live).
 *
 * categoryId / uomId are required UUID references on the backend contract and
 * stock-service does not yet expose category/UOM lookup endpoints, so they are
 * captured as UUID inputs (paste the category/UOM id from the stock masters).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewStockItemPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    code: "",
    categoryId: "",
    uomId: "",
    itemType: "consumable",
    reorderLevel: "0",
    reorderQty: "0",
    valuationMethod: "WAVG",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/stock/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          categoryId: form.categoryId,
          uomId: form.uomId,
          itemType: form.itemType,
          reorderLevel: Math.max(0, Math.trunc(Number(form.reorderLevel || "0"))),
          reorderQty: Math.max(0, Math.trunc(Number(form.reorderQty || "0"))),
          valuationMethod: form.valuationMethod,
        }),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Stock item created.");
      router.refresh();
      setTimeout(() => router.push("/stock/list"), 700);
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Stock Item"
        subtitle="Create a stock-keeping unit (SKU) in the inventory register."
        back="/stock/list"
        backLabel="Stock Items"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-name">Item name</label>
              <input id="item-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-code">Item code</label>
              <input id="item-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-cat">Category ID</label>
              <input id="item-cat" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} placeholder="UUID of stock category" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-uom">Unit of measure ID</label>
              <input id="item-uom" required value={form.uomId} onChange={(e) => setForm({ ...form, uomId: e.target.value })} placeholder="UUID of UOM" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-type">Item type</label>
              <select id="item-type" value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value })} style={inputStyle}>
                <option value="consumable">Consumable</option>
                <option value="fixed_asset">Fixed asset</option>
                <option value="service">Service</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-reorder-level">Reorder level</label>
              <input id="item-reorder-level" type="number" min="0" step="1" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-reorder-qty">Reorder quantity</label>
              <input id="item-reorder-qty" type="number" min="0" step="1" value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-valuation">Valuation method</label>
              <select id="item-valuation" value={form.valuationMethod} onChange={(e) => setForm({ ...form, valuationMethod: e.target.value })} style={inputStyle}>
                <option value="WAVG">Weighted average (WAVG)</option>
                <option value="FIFO">First-in first-out (FIFO)</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Create item"}
          </button>
        </form>
      </div>
    </>
  );
}
