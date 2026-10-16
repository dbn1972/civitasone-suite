"use client";

/**
 * New Stock Entry — records a receipt, issue or adjustment against the stock
 * ledger via POST /v1/stock/entries (async: 202 + queue, stock-service
 * entry consumer). The "+ New Entry" actions on /stock, /stock/dashboard and
 * /stock/ledger link here.
 *
 * GAP-STOCK-LEDGER-NEW-01: Inter-warehouse transfers intentionally not offered;
 *   the service has no warehouse list endpoint yet. NEEDS OWNER DECISION.
 * GAP-STOCK-LEDGER-NEW-02: Adjustment direction (increase/decrease); decimal
 *   qty; issue on-hand warning.
 * GAP-STOCK-LEDGER-NEW-07: Multi-line items in one POST.
 * GAP-STOCK-LEDGER-NEW-08: Searchable EntityPicker instead of limit=200 select.
 */
import { todayIST } from "@/lib/formatters";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader, EntityPicker } from "../../../../_components/ds";
import type { EntityOption } from "../../../../_components/ds/EntityPicker";
import { useFormError } from "@/lib/useFormError";
import { rupeesInputToMinorNumber, rupeesToMinorString } from "@/lib/money";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

type Item = { id: string; name: string; code?: string; onHand?: number };

// static reference: entry-type options accepted by POST /v1/stock/entries.
const ENTRY_TYPES: Array<{ value: string; label: string; help: string }> = [
  { value: "receipt", label: "Receipt", help: "Stock coming in (purchase, return, opening balance)." },
  { value: "issue", label: "Issue", help: "Stock going out to a department or consumer." },
  { value: "adjustment", label: "Adjustment", help: "Correct the book quantity after a count or write-off." },
];

// GAP-STOCK-LEDGER-NEW-02: adjustment direction options
const ADJUSTMENT_DIRECTIONS: Array<{ value: string; label: string }> = [
  { value: "increase", label: "Increase (add to stock)" },
  { value: "decrease", label: "Decrease (remove from stock)" },
];

interface EntryLine {
  lineId: string;
  itemId: string;
  qty: string;
  rate: string;
}

function makeLine(): EntryLine {
  return { lineId: crypto.randomUUID(), itemId: "", qty: "", rate: "" };
}

const today = () => todayIST();

const INITIAL_HEADER = {
  entryType: "receipt",
  /** GAP-STOCK-LEDGER-NEW-02: direction for adjustment type. */
  adjustmentDirection: "increase",
  postingDate: today(),
  refNo: "",
  notes: "",
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  fontSize: 14, border: "1px solid var(--line)", borderRadius: 10,
  background: "var(--panel)", color: "var(--ink)", minHeight: 44,
};

function validateLines(
  lines: EntryLine[],
  entryType: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  lines.forEach((l, i) => {
    if (!l.itemId) errors[`line_${i}_itemId`] = "Pick an item.";
    const qty = Number(l.qty);
    if (!l.qty || !Number.isFinite(qty) || qty <= 0) {
      errors[`line_${i}_qty`] = "Enter a quantity greater than zero.";
    }
    if (entryType === "receipt" && (l.rate === "" || l.rate === "0")) {
      errors[`line_${i}_rate`] = "Rate is required for receipts and must be greater than zero.";
    } else if (l.rate !== "") {
      if (rupeesToMinorString(l.rate, { allowZero: false }) === null) {
        errors[`line_${i}_rate`] = "Rate must be a positive amount with at most 2 decimals.";
      }
    }
  });
  return errors;
}

function validateHeader(
  form: typeof INITIAL_HEADER,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.postingDate)) errors.postingDate = "Pick a posting date.";
  if (form.postingDate > todayIST()) errors.postingDate = "Posting date cannot be in the future.";
  return errors;
}

// GAP-STOCK-LEDGER-NEW-08: adapt EntityPicker search to stock items endpoint.
function useItemSearch() {
  return useCallback(async (query: string, signal: AbortSignal): Promise<EntityOption[]> => {
    const qs = new URLSearchParams({ limit: "20" });
    if (query) qs.set("search", query);
    const res = await fetch(`/api/proxy/v1/stock/items?${qs.toString()}`, { credentials: "same-origin", signal });
    if (!res.ok) throw new Error("items_search_failed");
    const raw = (await res.json()) as unknown;
    const list: Item[] = Array.isArray(raw) ? (raw as Item[]) : ((raw as { data?: Item[] })?.data ?? []);
    return list.map((it) => ({
      id: it.id,
      label: it.name,
      sublabel: it.code,
    }));
  }, []);
}

export default function NewStockEntryPage() {
  const router = useRouter();
  const [header, setHeader] = useState(INITIAL_HEADER);
  // GAP-STOCK-LEDGER-NEW-07: lines array instead of single item.
  const [lines, setLines] = useState<EntryLine[]>([makeLine()]);
  // Cache for on-hand lookup (itemId -> onHand).
  const [onHandCache, setOnHandCache] = useState<Record<string, number | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("stock entry");
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const dirty = useMemo(() => {
    const headerDirty = Object.keys(INITIAL_HEADER).some(
      (k) => header[k as keyof typeof INITIAL_HEADER] !== INITIAL_HEADER[k as keyof typeof INITIAL_HEADER]
    );
    const linesDirty = lines.some((l) => l.itemId || l.qty || l.rate);
    return headerDirty || linesDirty;
  }, [header, lines]);
  useUnsavedChangesGuard(dirty);

  const allErrors = useMemo(
    () => ({ ...lineErrors, ...headerErrors, ...formError.fieldErrors }),
    [lineErrors, headerErrors, formError.fieldErrors],
  );

  const entryHelp = ENTRY_TYPES.find((t) => t.value === header.entryType)?.help ?? "";
  const itemSearch = useItemSearch();

  // Fetch on-hand qty when an item is selected and entry type is "issue".
  const fetchOnHand = useCallback(async (itemId: string) => {
    if (!itemId || onHandCache[itemId] !== undefined) return;
    try {
      const res = await fetch(`/api/proxy/v1/stock/items/${itemId}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const raw = (await res.json()) as { onHand?: number; quantityOnHand?: number };
      const qty = raw.onHand ?? raw.quantityOnHand;
      setOnHandCache((prev) => ({ ...prev, [itemId]: qty }));
    } catch { /* non-fatal */ }
  }, [onHandCache]);

  // Update a single line field.
  function updateLine(index: number, patch: Partial<EntryLine>) {
    setLines((prev) => prev.map((l, i) => i === index ? { ...l, ...patch } : l));
  }

  // When the item is selected for an issue line, prefetch on-hand.
  function onLineItemChange(index: number, newItemId: string | string[] | null) {
    const id = Array.isArray(newItemId) ? (newItemId[0] ?? "") : (newItemId ?? "");
    updateLine(index, { itemId: id });
    if (id && header.entryType === "issue") void fetchOnHand(id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    formError.clear();
    const lErrs = validateLines(lines, header.entryType);
    const hErrs = validateHeader(header);
    setLineErrors(lErrs);
    setHeaderErrors(hErrs);
    if (Object.keys(lErrs).length + Object.keys(hErrs).length > 0) return;

    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const items = lines.map((l) => {
        const rateMinor = rupeesInputToMinorNumber(l.rate);
        const qty = Number(l.qty);
        // GAP-STOCK-LEDGER-NEW-02: for adjustment decrease, send a negative signed qty.
        const signedQty =
          header.entryType === "adjustment" && header.adjustmentDirection === "decrease"
            ? -Math.abs(qty)
            : Math.abs(qty);
        return { itemId: l.itemId, qty: signedQty, rateMinor, currency: "INR" };
      });

      const res = await fetch("/api/proxy/v1/stock/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: header.entryType,
          postingDate: header.postingDate,
          ...(header.refNo.trim() ? { refNo: header.refNo.trim() } : {}),
          ...(header.notes.trim() ? { notes: header.notes.trim() } : {}),
          items,
        }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        const state = await formError.fromResponse(res, "save");
        setMessage(state.message);
        return;
      }
      setMessage(res.status === 202 ? "Entry submitted — it will appear in the ledger shortly." : "Stock entry recorded.");
      setHeader(INITIAL_HEADER);
      setLines([makeLine()]);
      router.refresh();
      setTimeout(() => router.push("/stock/ledger"), 700);
    } catch (caught) {
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  function fieldErr(key: string, id: string) {
    const msg = submitted ? allErrors[key] : undefined;
    if (!msg) return null;
    return <p id={id} role="alert" style={{ fontSize: 12, color: "var(--bad)", margin: "4px 0 0" }}>{msg}</p>;
  }

  function ariaFor(key: string, id: string) {
    return submitted && allErrors[key] ? { "aria-invalid": true as const, "aria-describedby": id } : {};
  }

  return (
    <>
      <PageHeader
        title="New Stock Entry"
        subtitle="Record a receipt, issue or adjustment in the stock ledger."
        back="/stock/ledger"
        backLabel="Stock Ledger"
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
            {/* ── Entry type ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-type">Entry type</label>
              <select
                id="entry-type" value={header.entryType}
                onChange={(e) => setHeader({ ...header, entryType: e.target.value })}
                style={inputStyle} aria-describedby="entry-type-hint"
              >
                {ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <span id="entry-type-hint" style={{ fontSize: 12, color: "var(--mut)" }}>{entryHelp}</span>
            </div>

            {/* ── GAP-STOCK-LEDGER-NEW-02: Adjustment direction ── */}
            {header.entryType === "adjustment" && (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="adjustment-direction">Direction</label>
                <select
                  id="adjustment-direction" value={header.adjustmentDirection}
                  onChange={(e) => setHeader({ ...header, adjustmentDirection: e.target.value })}
                  style={inputStyle}
                >
                  {ADJUSTMENT_DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}

            {/* ── GAP-STOCK-LEDGER-NEW-07: Line items ── */}
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px", margin: 0, width: "100%" }}>
              <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 6px", color: "var(--ink)" }}>Items</legend>
              {lines.map((line, index) => {
                const onHand = onHandCache[line.itemId];
                const qtyNum = Number(line.qty);
                const showOnHandWarn =
                  header.entryType === "issue" &&
                  onHand !== undefined &&
                  Number.isFinite(qtyNum) &&
                  qtyNum > onHand;
                return (
                  <div key={line.lineId} style={{ borderBottom: index < lines.length - 1 ? "1px dashed var(--line)" : "none", paddingBottom: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>Line {index + 1}</span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {/* Item picker (GAP-STOCK-LEDGER-NEW-08: searchable EntityPicker) */}
                    <div style={{ marginBottom: 8 }}>
                      <label className="l" htmlFor={`entry-item-${index}`}>Item</label>
                      <EntityPicker
                        value={line.itemId || null}
                        onChange={(v) => onLineItemChange(index, v)}
                        search={itemSearch}
                        placeholder="Search for an item…"
                        noResultsText="No matching items"
                        searchErrorText="Couldn't search items. Retry."
                        searchingText="Searching…"
                        {...ariaFor(`line_${index}_itemId`, `entry-item-${index}-err`)}
                      />
                      {fieldErr(`line_${index}_itemId`, `entry-item-${index}-err`)}
                    </div>

                    {/* On-hand warning for issues (GAP-STOCK-LEDGER-NEW-02) */}
                    {showOnHandWarn && (
                      <p role="alert" style={{ fontSize: 12, color: "var(--warn, var(--bad))", margin: "0 0 6px" }}>
                        Warning: quantity ({qtyNum}) exceeds on-hand stock ({onHand}).
                      </p>
                    )}

                    {/* Quantity (GAP-STOCK-LEDGER-NEW-02: decimal, step="any") */}
                    <div style={{ marginBottom: 8 }}>
                      <label className="l" htmlFor={`entry-qty-${index}`}>Quantity</label>
                      <input
                        id={`entry-qty-${index}`} type="number" min="0.001" step="any" required value={line.qty}
                        onChange={(e) => updateLine(index, { qty: e.target.value })}
                        style={inputStyle} {...ariaFor(`line_${index}_qty`, `entry-qty-${index}-err`)}
                      />
                      {fieldErr(`line_${index}_qty`, `entry-qty-${index}-err`)}
                    </div>

                    {/* Rate */}
                    <div>
                      <label className="l" htmlFor={`entry-rate-${index}`}>Rate per unit (₹)</label>
                      <input
                        id={`entry-rate-${index}`} type="number" min="0" step="0.01" value={line.rate}
                        onChange={(e) => updateLine(index, { rate: e.target.value })}
                        style={inputStyle} {...ariaFor(`line_${index}_rate`, `entry-rate-${index}-err`)}
                      />
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>
                        {header.entryType === "receipt" ? "Required for receipts — used for weighted-average valuation." : "Optional."}
                      </span>
                      {fieldErr(`line_${index}_rate`, `entry-rate-${index}-err`)}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 4 }}
                onClick={() => setLines((prev) => [...prev, makeLine()])}
              >
                + Add line
              </button>
            </fieldset>

            {/* ── Posting date ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-date">Posting date</label>
              <input
                id="entry-date" type="date" required value={header.postingDate}
                max={todayIST()}
                onChange={(e) => setHeader({ ...header, postingDate: e.target.value })}
                style={inputStyle} {...ariaFor("postingDate", "entry-date-err")}
              />
              {fieldErr("postingDate", "entry-date-err")}
            </div>

            {/* ── Reference number ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-ref">Reference number</label>
              <input
                id="entry-ref" value={header.refNo}
                onChange={(e) => setHeader({ ...header, refNo: e.target.value })}
                style={inputStyle} placeholder="e.g. GRN-2026-0042"
              />
            </div>

            {/* ── Notes ── */}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-notes">Notes</label>
              <textarea
                id="entry-notes" rows={3} value={header.notes}
                onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {busy ? "Saving…" : "Record entry"}
            </button>
            <Link href="/stock/ledger" className="btn ghost">Cancel</Link>
          </div>
        </form>
      </div>
    </>
  );
}
