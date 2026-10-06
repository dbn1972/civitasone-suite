"use client";

/**
 * New Stock Item.
 *
 * GAP-STOCK-ITEMS-NEW-01: 202 → "Item submitted; it will appear shortly"
 *                          201/200 → "Stock item created" + immediate redirect
 * GAP-STOCK-ITEMS-NEW-02: Lookup failures show Retry, not a UUID text input.
 * GAP-STOCK-ITEMS-NEW-03: Inline field validation + backend fieldErrors rendered per field.
 * GAP-STOCK-ITEMS-NEW-04: No silent Math.trunc/clamp; validates finite >=0.
 * GAP-STOCK-ITEMS-NEW-05: Cancel button + dirty-form guard (beforeunload).
 * GAP-STOCK-ITEMS-NEW-06: Design tokens, no hard-coded hex colours.
 * GAP-STOCK-ITEMS-NEW-07: Helper text on item type select.
 * GAP-STOCK-ITEMS-NEW-08: aria-describedby linking errors to their fields.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

type Category = { id: string; name: string };
type Uom = { id: string; symbol: string; name: string };

const INITIAL = {
  name: "",
  code: "",
  categoryId: "",
  uomId: "",
  itemType: "consumable",
  reorderLevel: "",
  reorderQty: "",
  valuationMethod: "WAVG",
};

const ITEM_TYPE_HELP: Record<string, string> = {
  consumable: "A good that is used up when issued (stationery, fuel, reagents).",
  fixed_asset: "A durable good tracked in the Assets module after capitalisation.",
  service: "A non-stockable service item (labour, AMC). No physical inventory.",
};

// GAP-STOCK-ITEMS-NEW-06: token-based styles, no hard-coded hex colours.
// Mirrors packages/ds _formControlStyle but kept local since this form
// does not yet use the full Field/Input primitives.
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  fontSize: 14, border: "1px solid var(--line)", borderRadius: 10,
  background: "var(--panel)", color: "var(--ink)", minHeight: 44,
};

/** Client-side field-level validation returning field→message map. */
function validateForm(form: typeof INITIAL): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Item name is required.";
  const code = form.code.trim();
  if (!code) {
    errors.code = "Item code is required.";
  } else if (code.length > 64) {
    errors.code = "Item code must be 64 characters or fewer.";
  }
  if (!form.categoryId) errors.categoryId = "Pick a category.";
  if (!form.uomId) errors.uomId = "Pick a unit of measure.";
  const rl = Number(form.reorderLevel);
  if (form.reorderLevel !== "" && (!Number.isFinite(rl) || rl < 0)) {
    errors.reorderLevel = "Must be zero or a positive whole number.";
  }
  const rq = Number(form.reorderQty);
  if (form.reorderQty !== "" && (!Number.isFinite(rq) || rq < 0)) {
    errors.reorderQty = "Must be zero or a positive whole number.";
  }
  return errors;
}

export default function NewStockItemPage() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("stock item");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Dirty tracking (GAP-STOCK-ITEMS-NEW-05)
  const dirty = useMemo(
    () => Object.keys(INITIAL).some((k) => form[k as keyof typeof form] !== INITIAL[k as keyof typeof INITIAL]),
    [form],
  );
  useUnsavedChangesGuard(dirty);

  // Merge client-side and server-side field errors
  const allFieldErrors = useMemo(
    () => ({ ...clientErrors, ...formError.fieldErrors }),
    [clientErrors, formError.fieldErrors],
  );

  // Category picker
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);

  // UOM picker
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [uomsLoading, setUomsLoading] = useState(true);
  const [uomsError, setUomsError] = useState(false);

  const fetchCategories = useCallback(() => {
    setCategoriesLoading(true);
    setCategoriesError(false);
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/categories", { credentials: "same-origin" });
        if (!res.ok) throw new Error("categories_load_failed");
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw) ? (raw as Category[]) : ((raw as { data?: Category[] })?.data ?? []);
        if (active) setCategories(list);
      } catch {
        if (active) setCategoriesError(true);
      } finally {
        if (active) setCategoriesLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const fetchUoms = useCallback(() => {
    setUomsLoading(true);
    setUomsError(false);
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/uoms", { credentials: "same-origin" });
        if (!res.ok) throw new Error("uoms_load_failed");
        const raw = (await res.json()) as unknown;
        const list = Array.isArray(raw) ? (raw as Uom[]) : ((raw as { data?: Uom[] })?.data ?? []);
        if (active) setUoms(list);
      } catch {
        if (active) setUomsError(true);
      } finally {
        if (active) setUomsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  useEffect(() => { fetchCategories(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  useEffect(() => { fetchUoms(); }, []);

  // Selected UOM symbol (shown beside reorder fields, GAP-STOCK-ITEMS-NEW-04)
  const selectedUom = uoms.find((u) => u.id === form.uomId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    formError.clear();
    const errs = validateForm(form);
    setClientErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const rl = Number(form.reorderLevel || "0");
      const rq = Number(form.reorderQty || "0");
      const res = await fetch("/api/proxy/v1/stock/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim(),
          categoryId: form.categoryId,
          uomId: form.uomId,
          itemType: form.itemType,
          reorderLevel: Math.round(rl),
          reorderQty: Math.round(rq),
          valuationMethod: form.valuationMethod,
        }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        const state = await formError.fromResponse(res, "save");
        setMessage(state.message);
        return;
      }
      // GAP-STOCK-ITEMS-NEW-01: distinguish 202 (async queue) from 200/201 (sync).
      if (res.status === 202) {
        setMessage("Item submitted — it will appear shortly.");
      } else {
        setMessage("Stock item created.");
      }
      // Reset dirty so the guard does not fire on the programmatic navigation.
      setForm(INITIAL);
      router.refresh();
      setTimeout(() => router.push("/stock/list"), 700);
    } catch (caught) {
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  /** Render an inline per-field error (GAP-STOCK-ITEMS-NEW-08). */
  function fieldErr(field: string, id: string) {
    const msg = submitted ? allFieldErrors[field] : undefined;
    if (!msg) return null;
    return <p id={id} role="alert" style={{ fontSize: 12, color: "var(--bad)", margin: "4px 0 0" }}>{msg}</p>;
  }

  function ariaFor(field: string, id: string) {
    return submitted && allFieldErrors[field] ? { "aria-invalid": true as const, "aria-describedby": id } : {};
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
        <div
          role={isError ? "alert" : "status"}
          aria-live={isError ? "assertive" : "polite"}
          className="banner"
          style={{
            background: isError ? "var(--badbg, var(--panel))" : "var(--goodbg, var(--panel))",
            color: isError ? "var(--bad)" : "var(--good)",
            border: `1px solid ${isError ? "var(--bad)" : "var(--good)"}`,
            padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13,
          }}
        >
          {message}
        </div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" noValidate>
          <div className="fields">
            {/* ── Item name ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-name">Item name</label>
              <input
                id="item-name" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={inputStyle} {...ariaFor("name", "item-name-err")}
              />
              {fieldErr("name", "item-name-err")}
            </div>

            {/* ── Item code ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-code">Item code</label>
              <input
                id="item-code" required value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                style={inputStyle} placeholder="e.g. STAT-001"
                {...ariaFor("code", "item-code-err")}
              />
              <span style={{ fontSize: 12, color: "var(--mut)" }}>A short unique code. Max 64 characters.</span>
              {fieldErr("code", "item-code-err")}
            </div>

            {/* ── Category ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-cat">Category</label>
              {categoriesError ? (
                <>
                  <p role="alert" aria-live="assertive" id="item-cat-err" style={{ fontSize: 12, color: "var(--bad)", margin: "0 0 4px" }}>
                    Couldn&apos;t load categories.
                  </p>
                  <button type="button" className="btn ghost" onClick={fetchCategories}>Retry</button>
                </>
              ) : (
                <select
                  id="item-cat" required value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  disabled={categoriesLoading}
                  style={inputStyle} {...ariaFor("categoryId", "item-cat-err")}
                >
                  <option value="">{categoriesLoading ? "Loading…" : "Select a category"}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              {fieldErr("categoryId", "item-cat-err")}
            </div>

            {/* ── Unit of measure ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-uom">Unit of measure</label>
              {uomsError ? (
                <>
                  <p role="alert" aria-live="assertive" id="item-uom-err" style={{ fontSize: 12, color: "var(--bad)", margin: "0 0 4px" }}>
                    Couldn&apos;t load units of measure.
                  </p>
                  <button type="button" className="btn ghost" onClick={fetchUoms}>Retry</button>
                </>
              ) : (
                <select
                  id="item-uom" required value={form.uomId}
                  onChange={(e) => setForm({ ...form, uomId: e.target.value })}
                  disabled={uomsLoading}
                  style={inputStyle} {...ariaFor("uomId", "item-uom-err")}
                >
                  <option value="">{uomsLoading ? "Loading…" : "Select a unit of measure"}</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>{u.symbol} — {u.name}</option>
                  ))}
                </select>
              )}
              {fieldErr("uomId", "item-uom-err")}
            </div>

            {/* ── Item type (with helper text, GAP-STOCK-ITEMS-NEW-07) ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-type">Item type</label>
              <select
                id="item-type" value={form.itemType}
                onChange={(e) => setForm({ ...form, itemType: e.target.value })}
                style={inputStyle} aria-describedby="item-type-hint"
              >
                <option value="consumable">Consumable</option>
                <option value="fixed_asset">Fixed asset</option>
                <option value="service">Service</option>
              </select>
              <span id="item-type-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
                {ITEM_TYPE_HELP[form.itemType] ?? ""}
              </span>
            </div>

            {/* ── Reorder level ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-reorder-level">
                Reorder level{selectedUom ? ` (${selectedUom.symbol})` : ""}
              </label>
              <input
                id="item-reorder-level" type="number" min="0" step="1"
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                style={inputStyle} {...ariaFor("reorderLevel", "item-reorder-level-err")}
              />
              {fieldErr("reorderLevel", "item-reorder-level-err")}
            </div>

            {/* ── Reorder quantity ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-reorder-qty">
                Reorder quantity{selectedUom ? ` (${selectedUom.symbol})` : ""}
              </label>
              <input
                id="item-reorder-qty" type="number" min="0" step="1"
                value={form.reorderQty}
                onChange={(e) => setForm({ ...form, reorderQty: e.target.value })}
                style={inputStyle} {...ariaFor("reorderQty", "item-reorder-qty-err")}
              />
              {fieldErr("reorderQty", "item-reorder-qty-err")}
            </div>

            {/* ── Valuation method ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="item-valuation">Valuation method</label>
              <select
                id="item-valuation" value={form.valuationMethod}
                onChange={(e) => setForm({ ...form, valuationMethod: e.target.value })}
                style={inputStyle}
              >
                <option value="WAVG">Weighted average (WAVG)</option>
                <option value="FIFO">First-in first-out (FIFO)</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {busy ? "Saving…" : "Create item"}
            </button>
            <Link href="/stock/list" className="btn ghost">Cancel</Link>
          </div>
        </form>
      </div>
    </>
  );
}
