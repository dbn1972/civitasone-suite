"use client";

/**
 * New Stock Item.
 *
 * Wires to the canonical create endpoint POST /v1/stock/items via the gateway
 * proxy (stock-service already exposes the command + consumer). The form is a
 * real action with validation + accessible error reporting (aria-live).
 *
 * Category and UOM are loaded from their respective lookup endpoints and
 * presented as labelled <select> dropdowns. If a lookup fails, a UUID fallback
 * input is shown so the form remains usable.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

type Category = { id: string; name: string };
type Uom = { id: string; symbol: string; name: string };

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

  // Category picker
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // UOM picker
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [uomsLoading, setUomsLoading] = useState(true);
  const [uomsError, setUomsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/categories", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw) ? (raw as Category[]) : ((raw as { data?: Category[] })?.data ?? []);
        if (active) setCategories(list);
      } catch {
        if (active) setCategoriesError("Couldn't load categories. Enter the UUID manually.");
      } finally {
        if (active) setCategoriesLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/uoms", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw) ? (raw as Uom[]) : ((raw as { data?: Uom[] })?.data ?? []);
        if (active) setUoms(list);
      } catch {
        if (active) setUomsError("Couldn't load units of measure. Enter the UUID manually.");
      } finally {
        if (active) setUomsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

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
              <label className="l" htmlFor="item-cat">Category</label>
              {categoriesError ? (
                <>
                  <p role="alert" aria-live="assertive" style={{ fontSize: 12, color: "#b91c1c", margin: "0 0 4px" }}>{categoriesError}</p>
                  <input id="item-cat" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} placeholder="UUID of stock category" style={inputStyle} />
                </>
              ) : (
                <select id="item-cat" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={inputStyle}>
                  <option value="">{categoriesLoading ? "Loading…" : "Select a category"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-uom">Unit of measure</label>
              {uomsError ? (
                <>
                  <p role="alert" aria-live="assertive" style={{ fontSize: 12, color: "#b91c1c", margin: "0 0 4px" }}>{uomsError}</p>
                  <input id="item-uom" required value={form.uomId} onChange={(e) => setForm({ ...form, uomId: e.target.value })} placeholder="UUID of UOM" style={inputStyle} />
                </>
              ) : (
                <select id="item-uom" required value={form.uomId} onChange={(e) => setForm({ ...form, uomId: e.target.value })} style={inputStyle}>
                  <option value="">{uomsLoading ? "Loading…" : "Select a unit of measure"}</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>{u.symbol} — {u.name}</option>
                  ))}
                </select>
              )}
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
