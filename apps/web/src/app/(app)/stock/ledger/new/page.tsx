"use client";

/**
 * New Stock Entry — records a receipt, issue or adjustment against the stock
 * ledger via POST /v1/stock/entries (async: 202 + queue, stock-service
 * entry consumer). The "+ New Entry" actions on /stock, /stock/dashboard and
 * /stock/ledger link here; before this page existed they were dead links
 * (tests/contract/screens.contract.test.ts COMP-012).
 *
 * Inter-warehouse transfers are intentionally not offered: the service has no
 * warehouse list endpoint yet, so there is nothing honest to pick from.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

type Item = { id: string; name: string; code?: string };

// static reference: the fixed entry-type options accepted by POST /v1/stock/entries, not tenant data.
const ENTRY_TYPES: Array<{ value: string; label: string; help: string }> = [
  { value: "receipt", label: "Receipt", help: "Stock coming in (purchase, return, opening balance)." },
  { value: "issue", label: "Issue", help: "Stock going out to a department or consumer." },
  { value: "adjustment", label: "Adjustment", help: "Correct the book quantity after a count or write-off." },
];

const today = () => new Date().toISOString().slice(0, 10);

const INITIAL = { entryType: "receipt", itemId: "", qty: "", rate: "", postingDate: today(), refNo: "", notes: "" };

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  fontSize: 14, border: "1px solid var(--line)", borderRadius: 10,
  background: "var(--panel)", color: "var(--ink)", minHeight: 44,
};

function validateForm(form: typeof INITIAL): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.itemId) errors.itemId = "Pick an item.";
  const qty = Number(form.qty);
  if (!form.qty || !Number.isInteger(qty) || qty <= 0) errors.qty = "Enter a whole quantity greater than zero.";
  if (form.rate !== "") {
    const rate = Number(form.rate);
    if (!Number.isFinite(rate) || rate < 0) errors.rate = "Rate must be zero or a positive amount.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.postingDate)) errors.postingDate = "Pick a posting date.";
  return errors;
}

export default function NewStockEntryPage() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const formError = useFormError("stock entry");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const dirty = useMemo(
    () => Object.keys(INITIAL).some((k) => form[k as keyof typeof form] !== INITIAL[k as keyof typeof INITIAL]),
    [form],
  );
  useUnsavedChangesGuard(dirty);

  const allFieldErrors = useMemo(
    () => ({ ...clientErrors, ...formError.fieldErrors }),
    [clientErrors, formError.fieldErrors],
  );

  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState(false);

  const fetchItems = useCallback(() => {
    setItemsLoading(true);
    setItemsError(false);
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/stock/items?limit=200", { credentials: "same-origin" });
        if (!res.ok) throw new Error("items_load_failed");
        const raw = (await res.json()) as unknown;
        setItems(Array.isArray(raw) ? (raw as Item[]) : ((raw as { data?: Item[] })?.data ?? []));
      } catch {
        setItemsError(true);
      } finally {
        setItemsLoading(false);
      }
    })();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  useEffect(() => { fetchItems(); }, []);

  const entryHelp = ENTRY_TYPES.find((t) => t.value === form.entryType)?.help ?? "";

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
      // Rate is entered in rupees; the API takes integer paise.
      const rateMinor = form.rate === "" ? 0 : Math.round(Number(form.rate) * 100);
      const res = await fetch("/api/proxy/v1/stock/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: form.entryType,
          postingDate: form.postingDate,
          ...(form.refNo.trim() ? { refNo: form.refNo.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          items: [{ itemId: form.itemId, qty: Number(form.qty), rateMinor, currency: "INR" }],
        }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        const state = await formError.fromResponse(res, "save");
        setMessage(state.message);
        return;
      }
      setMessage(res.status === 202 ? "Entry submitted — it will appear in the ledger shortly." : "Stock entry recorded.");
      setForm(INITIAL);
      router.refresh();
      setTimeout(() => router.push("/stock/ledger"), 700);
    } catch (caught) {
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

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
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-type">Entry type</label>
              <select
                id="entry-type" value={form.entryType}
                onChange={(e) => setForm({ ...form, entryType: e.target.value })}
                style={inputStyle} aria-describedby="entry-type-hint"
              >
                {ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <span id="entry-type-hint" style={{ fontSize: 12, color: "var(--mut)" }}>{entryHelp}</span>
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-item">Item</label>
              {itemsError ? (
                <>
                  <p role="alert" aria-live="assertive" id="entry-item-err" style={{ fontSize: 12, color: "var(--bad)", margin: "0 0 4px" }}>
                    Couldn&apos;t load stock items.
                  </p>
                  <button type="button" className="btn ghost" onClick={fetchItems}>Retry</button>
                </>
              ) : (
                <select
                  id="entry-item" required value={form.itemId}
                  onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                  disabled={itemsLoading}
                  style={inputStyle} {...ariaFor("itemId", "entry-item-err")}
                >
                  <option value="">{itemsLoading ? "Loading…" : "Select an item"}</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.code ? `${i.code} — ${i.name}` : i.name}</option>
                  ))}
                </select>
              )}
              {fieldErr("itemId", "entry-item-err")}
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-qty">Quantity</label>
              <input
                id="entry-qty" type="number" min="1" step="1" required value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
                style={inputStyle} {...ariaFor("qty", "entry-qty-err")}
              />
              {fieldErr("qty", "entry-qty-err")}
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-rate">Rate per unit (₹)</label>
              <input
                id="entry-rate" type="number" min="0" step="0.01" value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                style={inputStyle} {...ariaFor("rate", "entry-rate-err")}
              />
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Optional. Used for stock valuation.</span>
              {fieldErr("rate", "entry-rate-err")}
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-date">Posting date</label>
              <input
                id="entry-date" type="date" required value={form.postingDate}
                onChange={(e) => setForm({ ...form, postingDate: e.target.value })}
                style={inputStyle} {...ariaFor("postingDate", "entry-date-err")}
              />
              {fieldErr("postingDate", "entry-date-err")}
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-ref">Reference number</label>
              <input
                id="entry-ref" value={form.refNo}
                onChange={(e) => setForm({ ...form, refNo: e.target.value })}
                style={inputStyle} placeholder="e.g. GRN-2026-0042"
              />
            </div>

            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="entry-notes">Notes</label>
              <textarea
                id="entry-notes" rows={3} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
