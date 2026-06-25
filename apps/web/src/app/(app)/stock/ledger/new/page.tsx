"use client";

/**
 * New Stock Entry (receipt / issue / transfer / adjustment).
 * POSTs to the real stock-service endpoint POST /v1/stock/entries via the
 * gateway proxy. Body shape (per createEntryBody):
 *   { entryType, postingDate, fromWarehouseId?, toWarehouseId?, notes?,
 *     items: [{ itemId, qty, rateMinor }] }
 * Items are loaded from GET /v1/stock/items. An optional ?itemId= query param
 * (passed from a stock item detail page) preselects the line item.
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

type ItemRow = { id: string; name?: string; sku?: string | null; itemCode?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function NewStockEntryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const presetItemId = params.get("itemId") ?? "";

  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [entryType, setEntryType] = useState<"receipt" | "issue" | "transfer" | "adjustment">("receipt");
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemId, setItemId] = useState(presetItemId);
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/items?limit=200", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load items (${res.status}).`);
        const json = (await res.json()) as { data?: ItemRow[] } | ItemRow[];
        if (active) setItems(Array.isArray(json) ? json : json.data ?? []);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "Failed to load items.");
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (presetItemId) setItemId(presetItemId);
  }, [presetItemId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const qtyNum = Math.round(Number(qty || "0"));
      const rateMinor = Math.round(Number(rate || "0") * 100);
      const wh = warehouseId.trim();
      const body: Record<string, unknown> = {
        entryType,
        postingDate,
        notes: notes || undefined,
        items: [{ itemId, qty: qtyNum, rateMinor }],
      };
      if (wh) {
        if (entryType === "issue") body.fromWarehouseId = wh;
        else body.toWarehouseId = wh;
      }
      const res = await fetch("/api/proxy/v1/stock/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Stock entry posted.");
      setQty("");
      setRate("");
      router.refresh();
      setTimeout(() => router.push("/stock/ledger"), 700);
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
        title="New Stock Entry"
        subtitle="Record a receipt, issue, transfer or adjustment."
        back="/stock/ledger"
        backLabel="Stock Ledger"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-type">Entry type</label>
              <select id="se-type" value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)} style={inputStyle}>
                <option value="receipt">Receipt</option>
                <option value="issue">Issue</option>
                <option value="transfer">Transfer</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-date">Posting date</label>
              <input id="se-date" required type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-item">Item</label>
              <select id="se-item" required value={itemId} onChange={(e) => setItemId(e.target.value)} style={inputStyle}>
                <option value="" disabled>Select an item…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>{[it.itemCode ?? it.sku, it.name].filter(Boolean).join(" · ") || it.id}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-qty">Quantity</label>
              <input id="se-qty" required type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-rate">Rate (₹ per unit)</label>
              <input id="se-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-wh">Warehouse ID (optional)</label>
              <input id="se-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="UUID" style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="se-notes">Notes</label>
              <input id="se-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy || !itemId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Posting…" : "Post entry"}
          </button>
        </form>
      </div>
    </>
  );
}
