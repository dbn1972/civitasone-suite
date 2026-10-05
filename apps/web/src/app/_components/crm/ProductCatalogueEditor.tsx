"use client";
/**
 * ProductCatalogueEditor — QP-001 admin. CRUD the product catalogue: category,
 * code, name, unit, tax rate (basis points), unit price, currency, active window
 * and an enabled flag. Price is entered in rupees and converted to paise with
 * rupeesToMinorString (no float); an invalid price blocks the row. Only enabled,
 * in-window products are selectable in the quotation builder (see QP-003). A
 * failed load shows the saved-info badge and never fabricates an empty catalogue.
 *
 * GAP-CRM-PRODUCTS-01: prices/tax flow straight into quotations, so this screen
 * is admin-gated by (app)/crm/products/layout.tsx. A "Last changed" column
 * surfaces updatedBy/updatedAt; Delete steers the admin to soft-disable.
 *
 * GAP-CRM-PRODUCTS-02 (tax classification): the Tax % free input is replaced by
 * a GST-slab select (0/5/12/18/28) plus an explicit "Custom…" path that caps the
 * rate at 100% and asks for confirmation, so a fat-fingered 81% can no longer
 * save silently. An HSN/SAC code + CGST/SGST/IGST split needs a backend
 * product-schema change (no column today) and is deferred — see the fixer report.
 *
 * GAP-CRM-PRODUCTS-03 (blank → 0): a blank Price or Tax is now INVALID (not a
 * silent ₹0.00 / 0% live product); an explicit, typed 0 price is allowed only
 * after a confirm.
 *
 * GAP-CRM-PRODUCTS-05 (dirty / dates): each row keeps a snapshot of its loaded
 * state and shows an "Unsaved" marker when edited; the Live/Off badge reads
 * "Live after save" while dirty rather than claiming Live from unsaved edits;
 * and Active-to before Active-from is blocked with a message.
 *
 * GAP-CRM-PRODUCTS-04 (responsive): below 640px each product renders as a
 * stacked label/field card instead of a 10-column horizontally-scrolling table.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import { rupeesToMinorString, percentToBps } from "@/lib/money";
import { formatMoney, formatBps, formatIndianDate } from "@/lib/formatters";
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

/** The standard Indian GST slabs offered as presets; anything else is "Custom". */
const GST_SLABS = ["0", "5", "12", "18", "28"] as const;
/** Hard cap for a custom rate: a product tax above 100% is a data-entry error. */
const MAX_TAX_PERCENT = 100;

interface Row extends Omit<Product, "priceMinor" | "taxRateBps"> {
  key: string;
  priceRupees: string;
  taxPercent: string;
  /** True when the tax rate is not a standard slab (drives the "Custom" input). */
  taxCustom: boolean;
  /** JSON snapshot of the saved payload fields, for dirty detection (GAP-05). */
  snapshot: string;
}
let SEQ = 0;

function snapshotOf(r: { category: string; code: string; name: string; unit: string; priceRupees: string; taxPercent: string; currency: string; activeFrom: string; activeTo: string; enabled: boolean }): string {
  return JSON.stringify([r.category, r.code, r.name, r.unit, r.priceRupees, r.taxPercent, r.currency, r.activeFrom, r.activeTo, r.enabled]);
}

function toRow(p: Product): Row {
  const { priceMinor, taxRateBps, ...rest } = p;
  const rupees = (BigInt(priceMinor || "0") / 100n).toString() + "." + (BigInt(priceMinor || "0") % 100n).toString().padStart(2, "0");
  const taxPercent = taxRateBps ? String(taxRateBps / 100) : p.id ? "0" : "";
  const taxCustom = taxPercent !== "" && !(GST_SLABS as readonly string[]).includes(taxPercent);
  const base = {
    ...rest,
    key: p.id ?? `new-${SEQ++}`,
    priceRupees: priceMinor && priceMinor !== "0" ? rupees : "",
    taxPercent,
    taxCustom,
  };
  return { ...base, snapshot: snapshotOf({ ...base, activeFrom: base.activeFrom ?? "", activeTo: base.activeTo ?? "" }) };
}
function blank(): Product {
  return { category: "", code: "", name: "", unit: "", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "", enabled: true };
}

export function ProductCatalogueEditor() {
  const t = useTranslations("crmProductCatalogueEditor");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // GAP-CRM-PRODUCTS-03: a typed-0 price saves only after this acknowledgement.
  const [confirmZeroKey, setConfirmZeroKey] = useState<string | null>(null);
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
    const base = { ...toRow(blank()), snapshot: "" }; // empty snapshot → always dirty until first save
    setRows((prev) => [...prev, base]);
  }

  function isDirty(row: Row): boolean {
    return snapshotOf({ ...row, activeFrom: row.activeFrom ?? "", activeTo: row.activeTo ?? "" }) !== row.snapshot;
  }

  /** Price in paise. Blank is INVALID (null), not a silent 0 (GAP-03). */
  function priceMinorOf(row: Row): string | null {
    if (row.priceRupees.trim() === "") return null;
    if (row.priceRupees.trim() === "0" || /^0\.0{1,2}$/.test(row.priceRupees.trim())) return "0";
    return rupeesToMinorString(row.priceRupees.trim());
  }
  /** Tax in bps. Blank is INVALID (null); custom rate is capped at 100% (GAP-02/03). */
  function taxBpsOf(row: Row): number | null {
    const t = row.taxPercent.trim();
    if (t === "") return null;
    const bps = percentToBps(t);
    if (bps === null) return null;
    if (bps > MAX_TAX_PERCENT * 100) return null;
    return bps;
  }
  /** True only when the active window is coherent (to >= from), GAP-05. */
  function datesValid(row: Row): boolean {
    const from = row.activeFrom?.slice(0, 10) ?? "";
    const to = row.activeTo?.slice(0, 10) ?? "";
    if (from && to) return to >= from;
    return true;
  }
  function rowValid(row: Row): boolean {
    return row.name.trim().length > 0 && row.code.trim().length > 0 && priceMinorOf(row) !== null && taxBpsOf(row) !== null && datesValid(row);
  }

  function buildPayload(row: Row, priceMinor: string, taxRateBps: number): Product {
    return {
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
  }

  async function persist(row: Row, payload: Product) {
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

  async function save(row: Row) {
    setMessage("");
    setError("");
    const priceMinor = priceMinorOf(row);
    const taxRateBps = taxBpsOf(row);
    if (!rowValid(row) || priceMinor === null || taxRateBps === null) {
      if (!datesValid(row)) {
        setError(t("activeToBeforeFrom", { name: row.name || row.code || t("newLabel") }));
      } else {
        setError(t("needsFields", { name: row.name || row.code || t("newLabel"), max: MAX_TAX_PERCENT }));
      }
      return;
    }
    // GAP-03: a genuine ₹0 price is allowed but must be acknowledged.
    if (priceMinor === "0") {
      setConfirmZeroKey(row.key);
      return;
    }
    await persist(row, buildPayload(row, priceMinor, taxRateBps));
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
  const zeroRow = rows.find((r) => r.key === confirmZeroKey) ?? null;

  function onTaxSlabChange(key: string, value: string) {
    if (value === "custom") update(key, { taxCustom: true, taxPercent: "" });
    else update(key, { taxCustom: false, taxPercent: value });
  }

  return (
    <div className="card">
      {/* GAP-CRM-PRODUCTS-04: stacked-card layout under 640px. */}
      <style>{`
        @media (max-width: 640px) {
          .pce-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
          .pce-table, .pce-table tbody, .pce-table tr, .pce-table td { display: block; width: 100%; }
          .pce-table tr { border: 1px solid var(--line); border-radius: 10px; margin: 8px 0; padding: 8px; }
          .pce-table td { display: grid; grid-template-columns: 40% 60%; gap: 8px; align-items: center; padding: 4px 0; border: 0; }
          .pce-table td::before { content: attr(data-label); font-size: 12px; color: var(--muted); font-weight: 600; }
          .pce-scroll { overflow-x: visible; }
        }
      `}</style>
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
        <div className="pce-scroll" style={{ overflowX: "auto" }}>
          <table className="tbl pce-table" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th style={{ width: 120 }}>Price (₹)</th>
                <th style={{ width: 140 }}>{t("colTax")}</th>
                <th>Active from</th>
                <th>Active to</th>
                <th>Enabled</th>
                <th>{t("colLastChanged")}</th>
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
                const datesOk = datesValid(row);
                const dirty = isDirty(row);
                // The Live/Off badge is computed from the SAVED window, not the
                // in-memory edits (GAP-05): a dirty row reads "Live after save".
                const savedSelectable = row.id
                  ? isProductSelectable({ ...blank(), enabled: row.enabled, activeFrom: row.activeFrom, activeTo: row.activeTo } as Product)
                  : row.enabled;
                return (
                  <tr key={row.key}>
                    <td data-label={t("colCode")}>
                      <label className="sr-only" htmlFor={`${headingId}-code-${row.key}`}>Code for product {n}</label>
                      <input id={`${headingId}-code-${row.key}`} value={row.code} aria-invalid={row.code.trim() ? undefined : true} onChange={(e) => update(row.key, { code: e.target.value })} style={inputStyle} placeholder="SKU" />
                    </td>
                    <td data-label={t("colName")}>
                      <label className="sr-only" htmlFor={`${headingId}-name-${row.key}`}>Name for product {n}</label>
                      <input id={`${headingId}-name-${row.key}`} value={row.name} aria-invalid={row.name.trim() ? undefined : true} onChange={(e) => update(row.key, { name: e.target.value })} style={inputStyle} />
                    </td>
                    <td data-label={t("colCategory")}>
                      <label className="sr-only" htmlFor={`${headingId}-cat-${row.key}`}>Category for product {n}</label>
                      <input id={`${headingId}-cat-${row.key}`} value={row.category} onChange={(e) => update(row.key, { category: e.target.value })} style={inputStyle} />
                    </td>
                    <td data-label={t("colUnit")}>
                      <label className="sr-only" htmlFor={`${headingId}-unit-${row.key}`}>Unit for product {n}</label>
                      <input id={`${headingId}-unit-${row.key}`} value={row.unit} onChange={(e) => update(row.key, { unit: e.target.value })} style={inputStyle} placeholder="each" />
                    </td>
                    <td data-label={t("colPrice")}>
                      <label className="sr-only" htmlFor={`${headingId}-price-${row.key}`}>Price for product {n}</label>
                      <input id={`${headingId}-price-${row.key}`} inputMode="decimal" value={row.priceRupees} aria-invalid={priceOk ? undefined : true} onChange={(e) => update(row.key, { priceRupees: e.target.value })} style={{ ...inputStyle, textAlign: "end" }} placeholder="0.00" />
                      {row.priceRupees.trim() && priceOk ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatMoney(priceMinorOf(row)!)}</span> : null}
                    </td>
                    <td data-label={t("colTax")}>
                      <label className="sr-only" htmlFor={`${headingId}-tax-${row.key}`}>Tax percent for product {n}</label>
                      <select
                        id={`${headingId}-tax-${row.key}`}
                        value={row.taxCustom ? "custom" : row.taxPercent}
                        aria-invalid={taxOk ? undefined : true}
                        onChange={(e) => onTaxSlabChange(row.key, e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">{t("selectGst")}</option>
                        {GST_SLABS.map((s) => <option key={s} value={s}>{t("gstSlab", { slab: s })}</option>)}
                        <option value="custom">{t("custom")}</option>
                      </select>
                      {row.taxCustom ? (
                        <>
                          <label className="sr-only" htmlFor={`${headingId}-taxcustom-${row.key}`}>{t("customTaxLabel", { n })}</label>
                          <input
                            id={`${headingId}-taxcustom-${row.key}`}
                            inputMode="decimal"
                            value={row.taxPercent}
                            aria-invalid={taxOk ? undefined : true}
                            onChange={(e) => update(row.key, { taxPercent: e.target.value })}
                            style={{ ...inputStyle, textAlign: "end", marginTop: 4 }}
                            placeholder={t("customTaxPlaceholder", { max: MAX_TAX_PERCENT })}
                          />
                        </>
                      ) : null}
                      {row.taxPercent.trim() && taxOk ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatBps(taxBpsOf(row)!)}</span> : null}
                      {row.taxPercent.trim() && !taxOk ? <span style={{ fontSize: 11, color: "#b42318" }}>{t("rateRange", { max: MAX_TAX_PERCENT })}</span> : null}
                    </td>
                    <td data-label={t("colActiveFrom")}>
                      <label className="sr-only" htmlFor={`${headingId}-from-${row.key}`}>Active from for product {n}</label>
                      <input id={`${headingId}-from-${row.key}`} type="date" value={row.activeFrom?.slice(0, 10) ?? ""} aria-invalid={datesOk ? undefined : true} onChange={(e) => update(row.key, { activeFrom: e.target.value })} style={inputStyle} />
                    </td>
                    <td data-label={t("colActiveTo")}>
                      <label className="sr-only" htmlFor={`${headingId}-to-${row.key}`}>Active to for product {n}</label>
                      <input id={`${headingId}-to-${row.key}`} type="date" value={row.activeTo?.slice(0, 10) ?? ""} aria-invalid={datesOk ? undefined : true} onChange={(e) => update(row.key, { activeTo: e.target.value })} style={inputStyle} />
                      {!datesOk ? <span style={{ fontSize: 11, color: "#b42318" }}>{t("activeToBefore")}</span> : null}
                    </td>
                    <td data-label={t("colEnabled")}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable product ${n}`} />
                        {dirty ? (row.enabled ? t("liveAfterSave") : t("offAfterSave")) : savedSelectable ? t("live") : t("off")}
                      </label>
                    </td>
                    <td data-label={t("colLastChanged")} style={{ fontSize: 12, color: "var(--muted)" }}>
                      {dirty ? (
                        <span style={{ color: "#b45309", fontWeight: 600 }} aria-label={t("unsavedAria", { n })}>{t("unsaved")}</span>
                      ) : row.id && (row.updatedAt || row.updatedBy) ? (
                        <span aria-label={t("lastChangedAria", { n })}>
                          {row.updatedBy ? row.updatedBy : t("unknownUser")}
                          {row.updatedAt ? ` · ${formatIndianDate(row.updatedAt)}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label={t("colActions")}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button type="button" size="sm" onClick={() => void save(row)} disabled={busy}>
                          {busy ? "…" : row.id ? "Save" : "Create"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete product ${n}`}>
                          Delete
                        </Button>
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
        <Button type="button" variant="ghost" onClick={addRow}>
          + Add product
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title={confirmRow ? `Delete product “${confirmRow.name || confirmRow.code || "(new)"}”?` : ""}
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              {t("deleteWarning")}
            </p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {t.rich("deletePrefer", { em: (chunks) => <em>{chunks}</em> })}
            </p>
          </>
        }
        confirmLabel={t("deleteAnyway")}
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void doDelete(confirmRow)}
      />

      <ConfirmDialog
        open={zeroRow !== null}
        title={zeroRow ? t("zeroTitle", { name: zeroRow.name || zeroRow.code }) : ""}
        description={t("zeroDescription")}
        confirmLabel={t("zeroConfirm")}
        busy={zeroRow ? busyKey === zeroRow.key : false}
        onCancel={() => setConfirmZeroKey(null)}
        onConfirm={() => {
          const row = zeroRow;
          setConfirmZeroKey(null);
          if (row) {
            const taxRateBps = taxBpsOf(row);
            if (taxRateBps !== null) void persist(row, buildPayload(row, "0", taxRateBps));
          }
        }}
      />
    </div>
  );
}
