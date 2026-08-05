"use client";
/**
 * ProductCatalogueEditor — QP-001 admin. CRUD the product catalogue: category,
 * code, name, unit, tax rate (basis points), unit price, currency, active window
 * and an enabled flag. Price is entered in rupees and converted to paise with
 * rupeesToMinorString (no float); an invalid price blocks the row. Only enabled,
 * in-window products are selectable in the quotation builder (see QP-003). A
 * failed load shows the saved-info badge and never fabricates an empty catalogue.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import { rupeesToMinorString, percentToBps } from "@/lib/money";
import { formatMoney, formatBps } from "@/lib/formatters";
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  isProductSelectable,
  type Product,
  type QpSource,
} from "@/lib/crm/quotation";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface Row extends Omit<Product, "priceMinor" | "taxRateBps"> {
  key: string;
  priceRupees: string;
  taxPercent: string;
}
let SEQ = 0;
function toRow(p: Product): Row {
  const { priceMinor, taxRateBps, ...rest } = p;
  const rupees = (BigInt(priceMinor || "0") / 100n).toString() + "." + (BigInt(priceMinor || "0") % 100n).toString().padStart(2, "0");
  return { ...rest, key: p.id ?? `new-${SEQ++}`, priceRupees: priceMinor && priceMinor !== "0" ? rupees : "", taxPercent: taxRateBps ? String(taxRateBps / 100) : "" };
}
function blank(): Product {
  return { category: "", code: "", name: "", unit: "", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true };
}

export function ProductCatalogueEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getProducts();
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, toRow(blank())]);
  }

  function priceMinorOf(row: Row): string | null {
    if (row.priceRupees.trim() === "") return "0";
    return rupeesToMinorString(row.priceRupees.trim());
  }
  function taxBpsOf(row: Row): number | null {
    if (row.taxPercent.trim() === "") return 0;
    return percentToBps(row.taxPercent.trim());
  }
  function rowValid(row: Row): boolean {
    return row.name.trim().length > 0 && row.code.trim().length > 0 && priceMinorOf(row) !== null && taxBpsOf(row) !== null;
  }

  async function save(row: Row) {
    setMessage("");
    setError("");
    const priceMinor = priceMinorOf(row);
    const taxRateBps = taxBpsOf(row);
    if (!rowValid(row) || priceMinor === null || taxRateBps === null) {
      setError(`Product “${row.name || row.code || "(new)"}” needs a name, code, a valid price (max 2 decimals) and a valid tax %.`);
      return;
    }
    const payload: Product = {
      ...(row.id ? { id: row.id } : {}),
      category: row.category.trim(),
      code: row.code.trim(),
      name: row.name.trim(),
      unit: row.unit.trim(),
      taxRateBps,
      priceMinor,
      currency: row.currency.trim() || "INR",
      activeFrom: row.activeFrom,
      activeTo: row.activeTo,
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateProduct(row.id, payload);
      else await createProduct(payload);
      setMessage(`Product “${payload.name}” saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the product.");
    } finally {
      setBusyKey(null);
    }
  }

  async function doDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteProduct(row.id);
      setMessage(`Product “${row.name}” deleted.`);
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the product.");
    } finally {
      setBusyKey(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading products…
      </p>
    );
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Product catalogue</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon="📦" title="No products yet" message="Add products so they can be quoted and priced." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th style={{ width: 120 }}>Price (₹)</th>
                <th style={{ width: 90 }}>Tax %</th>
                <th>Active from</th>
                <th>Active to</th>
                <th>Enabled</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const n = i + 1;
                const busy = busyKey === row.key;
                const priceOk = priceMinorOf(row) !== null;
                const taxOk = taxBpsOf(row) !== null;
                const selectable = row.id
                  ? isProductSelectable({ ...blank(), enabled: row.enabled, activeFrom: row.activeFrom, activeTo: row.activeTo } as Product)
                  : row.enabled;
                return (
                  <tr key={row.key}>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-code-${row.key}`}>Code for product {n}</label>
                      <input id={`${headingId}-code-${row.key}`} value={row.code} aria-invalid={row.code.trim() ? undefined : true} onChange={(e) => update(row.key, { code: e.target.value })} style={inputStyle} placeholder="SKU" />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-name-${row.key}`}>Name for product {n}</label>
                      <input id={`${headingId}-name-${row.key}`} value={row.name} aria-invalid={row.name.trim() ? undefined : true} onChange={(e) => update(row.key, { name: e.target.value })} style={inputStyle} />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-cat-${row.key}`}>Category for product {n}</label>
                      <input id={`${headingId}-cat-${row.key}`} value={row.category} onChange={(e) => update(row.key, { category: e.target.value })} style={inputStyle} />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-unit-${row.key}`}>Unit for product {n}</label>
                      <input id={`${headingId}-unit-${row.key}`} value={row.unit} onChange={(e) => update(row.key, { unit: e.target.value })} style={inputStyle} placeholder="each" />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-price-${row.key}`}>Price for product {n}</label>
                      <input id={`${headingId}-price-${row.key}`} inputMode="decimal" value={row.priceRupees} aria-invalid={priceOk ? undefined : true} onChange={(e) => update(row.key, { priceRupees: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} placeholder="0.00" />
                      {row.priceRupees.trim() && priceOk ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatMoney(priceMinorOf(row)!)}</span> : null}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-tax-${row.key}`}>Tax percent for product {n}</label>
                      <input id={`${headingId}-tax-${row.key}`} inputMode="decimal" value={row.taxPercent} aria-invalid={taxOk ? undefined : true} onChange={(e) => update(row.key, { taxPercent: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} placeholder="18" />
                      {row.taxPercent.trim() && taxOk ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatBps(taxBpsOf(row)!)}</span> : null}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-from-${row.key}`}>Active from for product {n}</label>
                      <input id={`${headingId}-from-${row.key}`} type="date" value={row.activeFrom?.slice(0, 10) ?? ""} onChange={(e) => update(row.key, { activeFrom: e.target.value })} style={inputStyle} />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-to-${row.key}`}>Active to for product {n}</label>
                      <input id={`${headingId}-to-${row.key}`} type="date" value={row.activeTo?.slice(0, 10) ?? ""} onChange={(e) => update(row.key, { activeTo: e.target.value })} style={inputStyle} />
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable product ${n}`} />
                        {selectable ? "Live" : "Off"}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn primary sm" onClick={() => void save(row)} disabled={busy}>
                          {busy ? "…" : row.id ? "Save" : "Create"}
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete product ${n}`}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding: 12 }}>
        <button type="button" className="btn ghost" onClick={addRow}>
          + Add product
        </button>
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title={confirmRow ? `Delete product “${confirmRow.name || confirmRow.code || "(new)"}”?` : ""}
        description="The product will no longer be quotable. This cannot be undone."
        confirmLabel="Delete product"
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void doDelete(confirmRow)}
      />
    </div>
  );
}
