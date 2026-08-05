"use client";
/**
 * QuotationBuilder — QP-003 / QP-005. Build a quotation from line items (product
 * picker → unit price seeded from the resolved price book, quantity, tax), with
 * per-line and grand totals computed in paise via lib money helpers (no float).
 * Persisted quotations expose version history, accept / reject, new-version and
 * convert-to-order (ConfirmDialog-gated). The Send action is blocked while an
 * approval is outstanding: the backend's 422 APPROVAL_REQUIRED is surfaced
 * honestly (QP-004) — we never fake a successful send. Embeds the approval panel.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { QuotationApprovalPanel } from "./QuotationApprovalPanel";
import {
  getQuotations,
  createQuotation,
  updateQuotation,
  sendQuotation,
  acceptQuotation,
  rejectQuotation,
  newQuotationVersion,
  convertToOrder,
  getQuotationVersions,
  getProducts,
  resolvePriceBook,
  lineNetMinor,
  lineTaxMinor,
  quotationTotalMinor,
  isProductSelectable,
  ApprovalRequiredError,
  type Quotation,
  type QuotationLine,
  type QuotationVersion,
  type Product,
  type PriceBook,
  type QpSource,
} from "@/lib/crm/quotation";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface LineDraft {
  productId: string;
  productName: string;
  quantity: string;
  unitPriceRupees: string;
  taxPercent: string;
}

const TEMPLATES = ["standard", "government-tender", "annual-contract"] as const;

function toRupees(minor: string): string {
  const m = BigInt(minor || "0");
  return (m / 100n).toString() + "." + (m % 100n).toString().padStart(2, "0");
}

function toLine(l: LineDraft): QuotationLine {
  return {
    productId: l.productId,
    productName: l.productName || undefined,
    quantity: Number(l.quantity) || 0,
    unitPriceMinor: rupeesToMinorString(l.unitPriceRupees.trim() || "0.01") ?? "0",
    taxRateBps: Math.round((Number(l.taxPercent) || 0) * 100),
  };
}

export function QuotationBuilder() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Quotation | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [template, setTemplate] = useState<string>("standard");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [versions, setVersions] = useState<QuotationVersion[]>([]);
  const [versionSource, setVersionSource] = useState<QpSource | "idle">("idle");
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Price-book resolve (seeds unit prices).
  const [resolvedBook, setResolvedBook] = useState<PriceBook | null>(null);
  const [rSegment, setRSegment] = useState("");
  const headingId = useId();

  async function load() {
    setSource("loading");
    const { data, source: s } = await getQuotations();
    setQuotations(data);
    setSource(s);
    const prod = await getProducts();
    setProducts(prod.data);
  }
  useEffect(() => {
    void load();
  }, []);

  function openQuote(q: Quotation) {
    setSelected(q);
    setIsNew(false);
    setTemplate(q.template || "standard");
    setLines(
      q.lines.map((l) => ({
        productId: l.productId,
        productName: l.productName ?? "",
        quantity: String(l.quantity),
        unitPriceRupees: toRupees(l.unitPriceMinor),
        taxPercent: String(l.taxRateBps / 100),
      })),
    );
    setMessage("");
    setError("");
    setVersions([]);
    setVersionSource("idle");
    if (q.id) void loadVersions(q.id);
  }
  function startNew() {
    setSelected(null);
    setIsNew(true);
    setTemplate("standard");
    setLines([]);
    setMessage("");
    setError("");
    setVersions([]);
    setVersionSource("idle");
  }

  async function loadVersions(id: string) {
    setVersionSource("idle");
    const { data, source: s } = await getQuotationVersions(id);
    setVersions(data);
    setVersionSource(s);
  }

  function priceForProduct(p: Product): string {
    const entry = resolvedBook?.entries.find((e) => e.productId === p.id);
    return entry ? entry.priceMinor : p.priceMinor;
  }

  function pickProduct(idx: number, productId: string) {
    const p = products.find((pr) => pr.id === productId);
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              productId,
              productName: p?.name ?? "",
              unitPriceRupees: p ? toRupees(priceForProduct(p)) : l.unitPriceRupees,
              taxPercent: p ? String(p.taxRateBps / 100) : l.taxPercent,
            }
          : l,
      ),
    );
  }

  const draftLines: QuotationLine[] = lines.filter((l) => l.productId).map(toLine);
  const grandTotal = quotationTotalMinor(draftLines);

  function linesValid(): boolean {
    if (lines.length === 0) return false;
    return lines.every((l) => {
      if (!l.productId) return false;
      const qty = Number(l.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return false;
      if (rupeesToMinorString(l.unitPriceRupees.trim()) === null) return false;
      return true;
    });
  }

  async function save() {
    setMessage("");
    setError("");
    if (!linesValid()) {
      setError("Every line needs a product, a whole-number quantity above zero and a valid unit price.");
      return;
    }
    const payload: Quotation = {
      ...(selected?.id ? { id: selected.id } : {}),
      ...(selected?.accountId ? { accountId: selected.accountId } : {}),
      ...(selected?.opportunityId ? { opportunityId: selected.opportunityId } : {}),
      template,
      version: selected?.version ?? 1,
      status: selected?.status ?? "draft",
      lines: draftLines,
    };
    setBusy(true);
    try {
      if (selected?.id) await updateQuotation(selected.id, payload);
      else await createQuotation(payload);
      setMessage("Quotation saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the quotation.");
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    if (!selected?.id) return;
    setMessage("");
    setError("");
    setBusy(true);
    try {
      await sendQuotation(selected.id);
      setMessage("Quotation sent.");
      await load();
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        setError(e.message);
        setBlocking(true);
      } else {
        setError(e instanceof Error ? e.message : "Could not send the quotation.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runAction(fn: () => Promise<void>, ok: string) {
    setMessage("");
    setError("");
    setBusy(true);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function runResolve() {
    const { data } = await resolvePriceBook({ segment: rSegment.trim() || undefined });
    setResolvedBook(data);
    setMessage(data ? `Prices will seed from “${data.name}”.` : "No price book matched — using catalogue prices.");
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading quotations…
      </p>
    );
  }

  const editing = isNew || selected !== null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Quotations</h3>
          {source === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        {quotations.length === 0 ? (
          <EmptyState icon="🧾" title="No quotations yet" message="Build a quotation from your product catalogue." />
        ) : (
          <table className="tbl" aria-labelledby={headingId}>
            <thead>
              <tr>
                <th>Template</th>
                <th className="num">Version</th>
                <th className="num">Lines</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id}>
                  <td>{q.template || "standard"}</td>
                  <td className="num">v{q.version}</td>
                  <td className="num">{q.lines.length}</td>
                  <td className="num">{formatMoney(quotationTotalMinor(q.lines))}</td>
                  <td>{q.status}</td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => openQuote(q)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: 12 }}>
          <button type="button" className="btn ghost" onClick={startNew}>
            + New quotation
          </button>
        </div>
      </div>

      {editing ? (
        <div className="card">
          <div className="card-h">
            <h3>{selected?.id ? `Quotation v${selected.version} (${selected.status})` : "New quotation"}</h3>
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

          <div style={{ display: "flex", gap: 12, padding: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              Template
              <select aria-label="Template" value={template} onChange={(e) => setTemplate(e.target.value)} style={inputStyle}>
                {TEMPLATES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              Seed prices for segment
              <input aria-label="Resolve segment for pricing" value={rSegment} onChange={(e) => setRSegment(e.target.value)} style={inputStyle} placeholder="government" />
            </label>
            <button type="button" className="btn ghost" onClick={() => void runResolve()}>
              Resolve price book
            </button>
            {resolvedBook ? <span style={{ fontSize: 12, color: "var(--muted)" }}>Applicable book: {resolvedBook.name}</span> : null}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 130 }}>Unit price (₹)</th>
                  <th style={{ width: 80 }}>Tax %</th>
                  <th className="num">Line net</th>
                  <th className="num">Tax</th>
                  <th className="num">Line total</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const n = idx + 1;
                  const line = toLine(l);
                  const net = lineNetMinor(line);
                  const tax = lineTaxMinor(line);
                  const total = (BigInt(net) + BigInt(tax)).toString();
                  const priceOk = rupeesToMinorString(l.unitPriceRupees.trim() || "0.01") !== null;
                  return (
                    <tr key={idx}>
                      <td>
                        <label className="sr-only" htmlFor={`${headingId}-prod-${idx}`}>Product for line {n}</label>
                        <select id={`${headingId}-prod-${idx}`} value={l.productId} aria-invalid={l.productId ? undefined : true} onChange={(e) => pickProduct(idx, e.target.value)} style={inputStyle}>
                          <option value="">Select product…</option>
                          {products.map((p) => (
                            <option key={p.id ?? p.code} value={p.id ?? ""} disabled={!isProductSelectable(p)}>
                              {p.name} ({p.code}){isProductSelectable(p) ? "" : " — inactive"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`${headingId}-qty-${idx}`}>Quantity for line {n}</label>
                        <input id={`${headingId}-qty-${idx}`} type="number" min={1} step={1} value={l.quantity} onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))} style={{ ...inputStyle, textAlign: "right" }} />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`${headingId}-price-${idx}`}>Unit price for line {n}</label>
                        <input id={`${headingId}-price-${idx}`} inputMode="decimal" value={l.unitPriceRupees} aria-invalid={priceOk ? undefined : true} onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, unitPriceRupees: e.target.value } : r)))} style={{ ...inputStyle, textAlign: "right" }} />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`${headingId}-tax-${idx}`}>Tax percent for line {n}</label>
                        <input id={`${headingId}-tax-${idx}`} inputMode="decimal" value={l.taxPercent} onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, taxPercent: e.target.value } : r)))} style={{ ...inputStyle, textAlign: "right" }} />
                      </td>
                      <td className="num">{formatMoney(net)}</td>
                      <td className="num">{formatMoney(tax)}</td>
                      <td className="num">{formatMoney(total)}</td>
                      <td>
                        <button type="button" className="btn ghost sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} aria-label={`Remove line ${n}`}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: "var(--muted)", fontSize: 13 }}>
                      No lines yet. Add a product line to start.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {lines.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>
                      Grand total
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatMoney(grandTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn ghost sm" onClick={() => setLines((prev) => [...prev, { productId: "", productName: "", quantity: "1", unitPriceRupees: "", taxPercent: "0" }])}>
              + Add line
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : selected?.id ? "Save quotation" : "Create quotation"}
            </button>
          </div>

          {selected?.id ? (
            <div style={{ display: "flex", gap: 8, padding: "0 12px 12px", flexWrap: "wrap" }}>
              <button type="button" className="btn primary sm" onClick={() => void doSend()} disabled={busy || blocking} title={blocking ? "An approval is outstanding" : undefined}>
                Send / Finalize
              </button>
              <button type="button" className="btn ghost sm" onClick={() => void runAction(() => acceptQuotation(selected.id!), "Quotation accepted.")} disabled={busy}>
                Accept
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setRejecting(true)} disabled={busy}>
                Reject
              </button>
              <button type="button" className="btn ghost sm" onClick={() => void runAction(() => newQuotationVersion(selected.id!), "New version created.")} disabled={busy}>
                New version
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirmConvert(true)} disabled={busy}>
                Convert to order
              </button>
            </div>
          ) : null}

          {blocking ? (
            <p role="status" style={{ fontSize: 13, color: "#b42318", padding: "0 12px 12px", fontWeight: 600 }}>
              Send is blocked: an approval is outstanding (see below). Nothing has been sent.
            </p>
          ) : null}

          {/* version history (QP-005) */}
          {selected?.id ? (
            <div style={{ padding: "0 12px 12px" }}>
              <h4 style={{ fontSize: 13, margin: "8px 0" }}>Version history</h4>
              {versionSource === "error" ? (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>— Version history could not be loaded. Showing saved information.</p>
              ) : versions.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>No prior versions.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                  {versions.map((v) => (
                    <li key={v.version} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                      <strong>v{v.version}</strong>
                      <span>{v.status}</span>
                      <span>{formatMoney(v.totalMinor)}</span>
                      {v.createdAt ? <span style={{ color: "var(--muted)" }}>{formatIndianDate(v.createdAt)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* QP-004 approvals — the gate on Send */}
      {selected?.id ? <QuotationApprovalPanel quotationId={selected.id} onBlockingChange={setBlocking} /> : null}

      <ConfirmDialog
        open={confirmConvert}
        title="Convert this quotation to an order?"
        description="An order will be raised from the accepted quotation. This starts fulfilment and cannot be undone."
        confirmLabel="Convert to order"
        busy={busy}
        onCancel={() => setConfirmConvert(false)}
        onConfirm={() => {
          setConfirmConvert(false);
          if (selected?.id) void runAction(() => convertToOrder(selected.id!), "Quotation converted to an order.");
        }}
      />

      <ConfirmDialog
        open={rejecting}
        danger
        requireReason
        reasonLabel="Reason for rejection"
        title="Reject this quotation?"
        description="The customer's quotation will be marked rejected."
        confirmLabel="Reject quotation"
        busy={busy}
        onCancel={() => setRejecting(false)}
        onConfirm={(reason) => {
          setRejecting(false);
          if (selected?.id) void runAction(() => rejectQuotation(selected.id!, reason ?? ""), "Quotation rejected.");
        }}
      />
    </div>
  );
}
