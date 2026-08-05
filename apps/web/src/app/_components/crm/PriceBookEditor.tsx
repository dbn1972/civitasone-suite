"use client";
/**
 * PriceBookEditor — QP-002 admin. CRUD price books (segment / currency /
 * geography / channel + per-product prices) and a resolve panel that shows which
 * book applies for a given set of criteria ("Applicable book: …"). Prices are
 * entered in rupees and stored as paise (no float). A failed load shows the
 * saved-info badge; a failed resolve says so honestly rather than implying none.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import {
  getPriceBooks,
  createPriceBook,
  updatePriceBook,
  deletePriceBook,
  resolvePriceBook,
  getProducts,
  type PriceBook,
  type PriceBookEntry,
  type Product,
  type QpSource,
} from "@/lib/crm/quotation";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface EntryRow {
  productId: string;
  priceRupees: string;
}
function blankBook(): PriceBook {
  return { name: "", segment: "", currency: "INR", geography: "", channel: "", entries: [], enabled: true };
}

export function PriceBookEditor() {
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<PriceBook | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmBook, setConfirmBook] = useState<PriceBook | null>(null);

  // Resolve panel state.
  const [rSegment, setRSegment] = useState("");
  const [rCurrency, setRCurrency] = useState("INR");
  const [rGeography, setRGeography] = useState("");
  const [rChannel, setRChannel] = useState("");
  const [resolved, setResolved] = useState<PriceBook | null>(null);
  const [resolveSource, setResolveSource] = useState<QpSource | "idle" | "loading">("idle");
  const headingId = useId();

  async function load() {
    setSource("loading");
    const { data, source: s } = await getPriceBooks();
    setBooks(data);
    setSource(s);
    const prod = await getProducts();
    setProducts(prod.data);
  }
  useEffect(() => {
    void load();
  }, []);

  function startNew() {
    setDraft(blankBook());
    setEntries([]);
    setMessage("");
    setError("");
  }
  function edit(b: PriceBook) {
    setDraft({ ...b });
    setEntries(
      b.entries.map((e) => ({
        productId: e.productId,
        priceRupees: (BigInt(e.priceMinor || "0") / 100n).toString() + "." + (BigInt(e.priceMinor || "0") % 100n).toString().padStart(2, "0"),
      })),
    );
    setMessage("");
    setError("");
  }

  function draftValid(d: PriceBook): boolean {
    return d.name.trim().length > 0 && entries.every((e) => e.productId.trim().length > 0 && rupeesToMinorString(e.priceRupees.trim() || "0.01") !== null);
  }

  async function save() {
    if (!draft) return;
    setMessage("");
    setError("");
    // Validate every entry price.
    const outEntries: PriceBookEntry[] = [];
    for (const e of entries) {
      if (!e.productId.trim()) continue;
      const minor = rupeesToMinorString(e.priceRupees.trim());
      if (minor === null) {
        setError("Every price-book entry needs a valid rupee price (max 2 decimals).");
        return;
      }
      outEntries.push({ productId: e.productId.trim(), priceMinor: minor });
    }
    if (draft.name.trim().length === 0) {
      setError("A price book needs a name.");
      return;
    }
    const payload: PriceBook = { ...draft, name: draft.name.trim(), entries: outEntries };
    setBusy(true);
    try {
      if (payload.id) await updatePriceBook(payload.id, payload);
      else await createPriceBook(payload);
      setMessage(`Price book “${payload.name}” saved.`);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the price book.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(b: PriceBook) {
    if (!b.id) {
      setConfirmBook(null);
      return;
    }
    setBusy(true);
    try {
      await deletePriceBook(b.id);
      setMessage(`Price book “${b.name}” deleted.`);
      setConfirmBook(null);
      if (draft?.id === b.id) setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the price book.");
    } finally {
      setBusy(false);
    }
  }

  async function runResolve() {
    setResolveSource("loading");
    const { data, source: s } = await resolvePriceBook({
      segment: rSegment.trim() || undefined,
      currency: rCurrency.trim() || undefined,
      geography: rGeography.trim() || undefined,
      channel: rChannel.trim() || undefined,
    });
    setResolved(data);
    setResolveSource(s);
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading price books…
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Price books</h3>
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

        {books.length === 0 && !draft ? (
          <EmptyState icon="💷" title="No price books yet" message="Create a price book for a segment, currency, geography and channel." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "0 12px", display: "grid", gap: 6 }}>
            {books.map((b) => (
              <li key={b.id ?? b.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 14 }}>
                  <strong>{b.name}</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    · {[b.segment, b.currency, b.geography, b.channel].filter(Boolean).join(" / ") || "any"} · {b.entries.length} price{b.entries.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn ghost sm" onClick={() => edit(b)}>
                    Edit
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => setConfirmBook(b)} aria-label={`Delete price book ${b.name}`}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div style={{ padding: 12 }}>
          {!draft ? (
            <button type="button" className="btn ghost" onClick={startNew}>
              + New price book
            </button>
          ) : (
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
              <legend style={{ fontSize: 13, fontWeight: 600 }}>{draft.id ? "Edit price book" : "New price book"}</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 8 }}>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Name
                  <input aria-label="Price book name" value={draft.name} aria-invalid={draft.name.trim() ? undefined : true} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Segment
                  <input aria-label="Segment" value={draft.segment} onChange={(e) => setDraft({ ...draft, segment: e.target.value })} style={inputStyle} placeholder="government" />
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Currency
                  <input aria-label="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Geography
                  <input aria-label="Geography" value={draft.geography} onChange={(e) => setDraft({ ...draft, geography: e.target.value })} style={inputStyle} placeholder="north" />
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Channel
                  <input aria-label="Channel" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })} style={inputStyle} placeholder="direct" />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 24 }}>
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }}>Prices</div>
              <div style={{ display: "grid", gap: 6 }}>
                {entries.map((e, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 140px 40px", gap: 6 }}>
                    <label className="sr-only" htmlFor={`${headingId}-ent-prod-${idx}`}>Product for entry {idx + 1}</label>
                    <select
                      id={`${headingId}-ent-prod-${idx}`}
                      value={e.productId}
                      onChange={(ev) => setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, productId: ev.target.value } : r)))}
                      style={inputStyle}
                    >
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id ?? p.code} value={p.id ?? ""}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`${headingId}-ent-price-${idx}`}>Price for entry {idx + 1}</label>
                    <input
                      id={`${headingId}-ent-price-${idx}`}
                      inputMode="decimal"
                      value={e.priceRupees}
                      onChange={(ev) => setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, priceRupees: ev.target.value } : r)))}
                      style={{ ...inputStyle, textAlign: "right" }}
                      placeholder="0.00"
                    />
                    <button type="button" className="btn ghost sm" onClick={() => setEntries((prev) => prev.filter((_, i) => i !== idx))} aria-label={`Remove entry ${idx + 1}`}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn ghost sm" onClick={() => setEntries((prev) => [...prev, { productId: "", priceRupees: "" }])}>
                  + Add price
                </button>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn ghost" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !draftValid(draft)}>
                  {busy ? "Saving…" : draft.id ? "Save book" : "Create book"}
                </button>
              </div>
            </fieldset>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ resolve --- */}
      <div className="card">
        <div className="card-h">
          <h3>Which book applies?</h3>
          {resolveSource === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: 8, padding: 12, alignItems: "end" }}>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Segment
            <input aria-label="Resolve segment" value={rSegment} onChange={(e) => setRSegment(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Currency
            <input aria-label="Resolve currency" value={rCurrency} onChange={(e) => setRCurrency(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Geography
            <input aria-label="Resolve geography" value={rGeography} onChange={(e) => setRGeography(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Channel
            <input aria-label="Resolve channel" value={rChannel} onChange={(e) => setRChannel(e.target.value)} style={inputStyle} />
          </label>
          <button type="button" className="btn primary" onClick={() => void runResolve()} disabled={resolveSource === "loading"}>
            {resolveSource === "loading" ? "Resolving…" : "Resolve"}
          </button>
        </div>
        <div style={{ padding: "0 12px 12px", fontSize: 14 }} aria-live="polite">
          {resolveSource === "idle" ? (
            <span style={{ color: "var(--muted)" }}>Enter criteria and resolve to see the applicable book.</span>
          ) : resolveSource === "error" ? (
            <span style={{ color: "var(--muted)" }}>— Could not resolve. Showing saved information.</span>
          ) : resolved ? (
            <span>
              Applicable book: <strong>{resolved.name}</strong>{" "}
              <span style={{ color: "var(--muted)" }}>
                ({resolved.entries.length} price{resolved.entries.length === 1 ? "" : "s"}
                {resolved.entries.length > 0 ? `, e.g. ${formatMoney(resolved.entries[0].priceMinor)}` : ""})
              </span>
            </span>
          ) : (
            <span style={{ color: "var(--muted)" }}>No price book matches these criteria.</span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmBook !== null}
        danger
        title={confirmBook ? `Delete price book “${confirmBook.name}”?` : ""}
        description="Quotations will no longer resolve prices from this book. This cannot be undone."
        confirmLabel="Delete book"
        busy={busy}
        onCancel={() => setConfirmBook(null)}
        onConfirm={() => confirmBook && void doDelete(confirmBook)}
      />
    </div>
  );
}
