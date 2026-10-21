"use client";
/**
 * PriceBookEditor — QP-002 admin. CRUD price books (segment / currency /
 * geography / channel + per-product prices) and a resolve panel that shows which
 * book applies for a given set of criteria ("Applicable book: …"). Prices are
 * entered in rupees and stored as paise (no float). A failed load shows the
 * saved-info badge; a failed resolve says so honestly rather than implying none.
 *
 * GAP-CRM-PRICE-BOOKS-01: each book shows its version and "Last changed by X on
 * <date> (IST)" (from the API's version/updatedBy/updatedAt), and editing a
 * LIVE (enabled) book requires an explicit reason first — a price change feeds
 * every quotation built afterwards, while already-captured quotations keep
 * their saved price.
 *
 * W2 rescan (GAP-CRM-PRICE-BOOKS-01): "Last changed by" shows the editor's NAME
 * (the API resolves it; an unresolved editor reads "Unknown user", never the user
 * id), the reason typed for a live-book edit is sent with the save and stored
 * against the new version, and each book has a History panel (who / when / why and
 * which fields and product prices moved) read from crm-service's append-only
 * price-book history. Effective-from/to dates are NOT built: they change which
 * book a quotation resolves, which is a pricing-policy decision for the owner.
 *
 * GAP-CRM-PRICE-BOOKS-02: Segment / Geography / Channel stay free text (there is no
 * master list to bind them to), so the form warns — without blocking — when a value
 * is not one any other book uses, since matching is exact-string.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoneyIn, formatIndianDate, formatDateTimeIST } from "@/lib/formatters";
import {
  getPriceBooks,
  createPriceBook,
  updatePriceBook,
  deletePriceBook,
  resolvePriceBook,
  getProducts,
  getPriceBookHistory,
  isProductSelectable,
  ALLOWED_CURRENCIES,
  type PriceBook,
  type PriceBookEntry,
  type PriceBookHistoryEntry,
  type Product,
  type QpSource,
} from "@/lib/crm/quotation";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

/**
 * F4-03: a price book carries a currency from the small allow-list
 * (INR/USD/EUR/GBP/AED). Entries are entered in the major unit and stored as minor
 * units (paise/cents); display uses formatMoneyIn so a non-INR book renders under the
 * right symbol rather than always ₹.
 */
const SUPPORTED_CURRENCIES = ALLOWED_CURRENCIES;

/** Unique, sorted, non-empty values of a book field across the loaded books. */
function usedValues(books: PriceBook[], pick: (b: PriceBook) => string): string[] {
  return Array.from(new Set(books.map(pick).map((v) => v.trim()).filter(Boolean))).sort();
}

/**
 * GAP-CRM-PRICE-BOOKS-02: how a typed scope value relates to the values other books use.
 * Matching on the server is EXACT, so "Government" never matches a quotation that says
 * "government". "ok" = used by another book (or blank = wildcard); "case" = differs only in
 * letter case from a used value; "new" = no other book uses it (possibly a typo).
 */
function scopeCheck(value: string, used: string[]): { kind: "ok" } | { kind: "case"; existing: string } | { kind: "new" } {
  const v = value.trim();
  if (v === "" || used.includes(v)) return { kind: "ok" };
  const lower = v.toLowerCase();
  const near = used.find((u) => u.toLowerCase() === lower);
  return near ? { kind: "case", existing: near } : { kind: "new" };
}

/** Book fields the change history can report, mapped to their message keys. */
const HISTORY_FIELD_KEYS = {
  name: "historyFieldName",
  segment: "historyFieldSegment",
  currency: "historyFieldCurrency",
  geography: "historyFieldGeography",
  channel: "historyFieldChannel",
  priority: "historyFieldPriority",
  enabled: "historyFieldEnabled",
} as const;
type HistoryFieldKey = keyof typeof HISTORY_FIELD_KEYS;
function isHistoryField(f: string): f is HistoryFieldKey {
  return Object.prototype.hasOwnProperty.call(HISTORY_FIELD_KEYS, f);
}

interface EntryRow {
  /** Stable per-row key (never the array index) so removing a row reconciles correctly. */
  key: string;
  productId: string;
  priceRupees: string;
}
let ENTRY_SEQ = 0;
function newEntry(productId = "", priceRupees = ""): EntryRow {
  return { key: `entry-${ENTRY_SEQ++}`, productId, priceRupees };
}
function blankBook(): PriceBook {
  return { name: "", segment: "", currency: "INR", geography: "", channel: "", entries: [], enabled: true };
}

export function PriceBookEditor() {
  const t = useTranslations("crmPriceBookEditor");
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [source, setSource] = useState<QpSource | "loading">("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<PriceBook | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmBook, setConfirmBook] = useState<PriceBook | null>(null);
  // GAP-CRM-PRICE-BOOKS-01: editing a LIVE (enabled) book changes the prices
  // every quotation built afterwards will use, so opening one for edit goes
  // through an explicit acknowledgement first.
  const [confirmEditBook, setConfirmEditBook] = useState<PriceBook | null>(null);
  // GAP-CRM-PRICE-BOOKS-01 (rescan): the reason typed in that dialog is kept for the draft and
  // sent with the save (it used to be collected and then thrown away).
  const [editReason, setEditReason] = useState<string | null>(null);
  // GAP-CRM-PRICE-BOOKS-01 (rescan): per-book change history panel.
  const [historyBook, setHistoryBook] = useState<PriceBook | null>(null);
  const [history, setHistory] = useState<{ status: "loading" | "ready" | "error"; rows: PriceBookHistoryEntry[] }>({
    status: "loading",
    rows: [],
  });

  // Resolve panel state.
  const [rSegment, setRSegment] = useState("");
  const [rCurrency, setRCurrency] = useState("INR");
  const [rGeography, setRGeography] = useState("");
  const [rChannel, setRChannel] = useState("");
  const [resolved, setResolved] = useState<PriceBook | null>(null);
  const [resolveSource, setResolveSource] = useState<QpSource | "idle" | "loading">("idle");
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getPriceBooks();
    if (!isLive()) return;
    setBooks(data);
    setSource(s);
    const prod = await getProducts();
    if (!isLive()) return;
    setProducts(prod.data);
  }
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  function startNew() {
    setDraft(blankBook());
    setEditReason(null);
    setEntries([]);
    setMessage("");
    setError("");
  }
  function edit(b: PriceBook, reason?: string) {
    setEditReason(reason?.trim() ? reason.trim() : null);
    setDraft({ ...b });
    setEntries(
      b.entries.map((e) =>
        newEntry(
          e.productId,
          (BigInt(e.priceMinor || "0") / 100n).toString() + "." + (BigInt(e.priceMinor || "0") % 100n).toString().padStart(2, "0"),
        ),
      ),
    );
    setMessage("");
    setError("");
  }

  /**
   * Edit entry point: a live (enabled, saved) book must be acknowledged first
   * because its prices feed every subsequent quotation; a draft/disabled book
   * opens straight away.
   */
  function requestEdit(b: PriceBook) {
    if (b.id && b.enabled) setConfirmEditBook(b);
    else edit(b);
  }

  function draftValid(d: PriceBook): boolean {
    return draftInvalidReason(d) === null;
  }

  /**
   * GAP-CRM-PRICE-BOOKS-06: a single source of truth for why Save is disabled,
   * shown as inline text beside the button (aria-describedby) rather than a
   * silently-disabled button. Aligned with save(): a blank price is INVALID
   * here too (the old draftValid defaulted blank to "0.01" and passed, then
   * save() rejected it — the button enabled and errored later).
   */
  function draftInvalidReason(d: PriceBook): string | null {
    if (d.name.trim().length === 0) return "A price book needs a name.";
    const chosen = entries.map((e) => e.productId.trim()).filter(Boolean);
    if (new Set(chosen).size !== chosen.length) return "Each product can appear only once — remove the duplicate row.";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.productId.trim().length === 0) return `Entry ${i + 1} needs a product.`;
      if (e.priceRupees.trim().length === 0) return `Entry ${i + 1} needs a price.`;
      if (rupeesToMinorString(e.priceRupees.trim()) === null) return `Entry ${i + 1} needs a valid rupee price (max 2 decimals).`;
    }
    return null;
  }

  /** True when a given entry's price is blank or invalid (drives aria-invalid). */
  function entryPriceInvalid(e: EntryRow): boolean {
    const t = e.priceRupees.trim();
    if (t.length === 0) return true;
    return rupeesToMinorString(t) === null;
  }

  async function save() {
    if (!draft) return;
    setMessage("");
    setError("");
    // Validate every entry price.
    const outEntries: PriceBookEntry[] = [];
    const seenProducts = new Set<string>();
    for (const e of entries) {
      if (!e.productId.trim()) continue;
      if (seenProducts.has(e.productId.trim())) {
        setError(t("duplicateProduct"));
        return;
      }
      seenProducts.add(e.productId.trim());
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
      if (payload.id) await updatePriceBook(payload.id, payload, editReason ? { reason: editReason } : {});
      else await createPriceBook(payload);
      setMessage(`Price book “${payload.name}” saved.`);
      setDraft(null);
      setEditReason(null);
      // The panel (if open) must not keep showing the history of the pre-save version.
      if (historyBook) void openHistory(historyBook, true);
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
      if (historyBook?.id === b.id) setHistoryBook(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the price book.");
    } finally {
      setBusy(false);
    }
  }

  /** Open (or, if already open for this book, close) the change-history panel. */
  async function openHistory(b: PriceBook, reload = false) {
    if (!b.id) return;
    if (!reload && historyBook?.id === b.id) {
      setHistoryBook(null);
      return;
    }
    setHistoryBook(b);
    setHistory({ status: "loading", rows: [] });
    const { data, source: s } = await getPriceBookHistory(b.id);
    setHistory(s === "error" ? { status: "error", rows: [] } : { status: "ready", rows: data });
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

  /** The books a draft is compared against: every OTHER saved book (its own saved scope is not evidence). */
  function otherBooks(d: PriceBook): PriceBook[] {
    return books.filter((b) => !d.id || b.id !== d.id);
  }

  /**
   * GAP-CRM-PRICE-BOOKS-02: a non-blocking hint under a scope field. Matching is exact, so a
   * value no other book uses (or one that differs only in letter case) may be a typo that
   * leaves this book unable to resolve. Free text stays allowed — there is no master list yet.
   */
  function scopeWarning(value: string, used: string[]) {
    const check = scopeCheck(value, used);
    if (check.kind === "ok") return null;
    return (
      <span role="status" style={{ fontSize: 12, color: "var(--warn, #b45309)" }}>
        {check.kind === "case"
          ? t("didYouMean", { value: value.trim(), existing: check.existing })
          : t("unknownValue", { value: value.trim() })}
      </span>
    );
  }

  /** A change-history value for display: null scope = "any", booleans = Enabled/Disabled. */
  function historyValue(v: string | number | boolean | null): string {
    if (v === null) return t("historyAny");
    if (typeof v === "boolean") return v ? t("historyOn") : t("historyOff");
    return String(v);
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
      {/* GAP-CRM-PRICE-BOOKS-02: suggest values already used in existing books so a
          typo (which would make a book that can never resolve) is easy to avoid.
          No backend master list of segments/geographies/channels exists yet. */}
      <datalist id={`${headingId}-segments`}>
        {usedValues(books, (b) => b.segment).map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id={`${headingId}-geographies`}>
        {usedValues(books, (b) => b.geography).map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id={`${headingId}-channels`}>
        {usedValues(books, (b) => b.channel).map((v) => <option key={v} value={v} />)}
      </datalist>
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
                  {b.version !== undefined ? <span style={{ fontSize: 12, color: "var(--muted)" }}>v{b.version}</span> : null}{" "}
                  <span style={{ color: "var(--muted)" }}>
                    · {[b.segment, b.currency, b.geography, b.channel].filter(Boolean).join(" / ") || "any"} · {b.entries.length} price{b.entries.length === 1 ? "" : "s"}
                  </span>
                  {b.updatedBy || b.updatedAt ? (
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }} aria-label={t("lastChangedAria", { name: b.name })}>
                      {/* The editor's NAME — the API resolves it. An editor it could not resolve reads
                          "Unknown user"; the raw user id is never shown. */}
                      {b.updatedAt && (b.updatedByName || b.updatedBy)
                        ? t("lastChangedByOn", { by: b.updatedByName ?? t("unknownUser"), date: formatIndianDate(b.updatedAt) })
                        : b.updatedByName || b.updatedBy
                          ? t("lastChangedBy", { by: b.updatedByName ?? t("unknownUser") })
                          : t("lastChangedOn", { date: formatIndianDate(b.updatedAt ?? "") })}
                    </span>
                  ) : null}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  {b.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void openHistory(b)}
                      aria-expanded={historyBook?.id === b.id}
                      aria-label={t("historyAria", { name: b.name })}
                    >
                      {t("history")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="sm" onClick={() => requestEdit(b)}>
                    Edit
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmBook(b)} aria-label={`Delete price book ${b.name}`}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {historyBook ? (
          <section
            aria-label={t("historyTitle", { name: historyBook.name })}
            style={{ margin: "8px 12px 0", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>{t("historyTitle", { name: historyBook.name })}</h4>
              <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryBook(null)}>
                {t("historyClose")}
              </Button>
            </div>
            {history.status === "loading" ? (
              <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>{t("historyLoading")}</p>
            ) : history.status === "error" ? (
              <div role="alert" style={{ fontSize: 13, color: "#b42318", display: "flex", gap: 8, alignItems: "center" }}>
                <span>{t("historyLoadFailed")}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void openHistory(historyBook, true)}>
                  {t("historyRetry")}
                </Button>
              </div>
            ) : history.rows.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>{t("historyEmpty")}</p>
            ) : (
              <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 10 }}>
                {history.rows.map((h) => (
                  <li key={h.id} style={{ fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                    <strong>
                      {t("historyHeading", {
                        version: h.version,
                        action: h.action === "create" ? t("historyCreated") : h.action === "item" ? t("historyPriceEdited") : t("historyEdited"),
                        by: h.changedByName ?? t("unknownUser"),
                        when: formatDateTimeIST(h.changedAt),
                      })}
                    </strong>
                    {h.reason ? <div style={{ color: "var(--ink2)" }}>{t("historyReason", { reason: h.reason })}</div> : null}
                    {h.fields.filter((f) => isHistoryField(f.field)).map((f) => (
                      <div key={f.field} style={{ color: "var(--muted)" }}>
                        {t("historyFieldChange", {
                          field: t(HISTORY_FIELD_KEYS[f.field as HistoryFieldKey]),
                          from: historyValue(f.from),
                          to: historyValue(f.to),
                        })}
                      </div>
                    ))}
                    {h.prices.map((p) => {
                      const product = products.find((pr) => pr.id === p.productId)?.name ?? t("historyUnknownProduct");
                      const cur = historyBook.currency;
                      return (
                        <div key={p.productId} style={{ color: "var(--muted)" }}>
                          {p.fromMinor === null && p.toMinor !== null
                            ? t("historyPriceAdded", { product, to: formatMoneyIn(p.toMinor, cur) })
                            : p.toMinor === null && p.fromMinor !== null
                              ? t("historyPriceRemoved", { product, from: formatMoneyIn(p.fromMinor, cur) })
                              : t("historyPriceChange", {
                                  product,
                                  from: formatMoneyIn(p.fromMinor ?? "0", cur),
                                  to: formatMoneyIn(p.toMinor ?? "0", cur),
                                })}
                        </div>
                      );
                    })}
                    {h.priceChangeCount > h.prices.length ? (
                      <div style={{ color: "var(--muted)" }}>{t("historyMorePrices", { count: h.priceChangeCount - h.prices.length })}</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}

        <div style={{ padding: 12 }}>
          {!draft ? (
            <Button type="button" variant="ghost" onClick={startNew}>
              + New price book
            </Button>
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
                  <input aria-label={t("segment")} list={`${headingId}-segments`} value={draft.segment} onChange={(e) => setDraft({ ...draft, segment: e.target.value })} style={inputStyle} placeholder={t("segmentPlaceholder")} />
                  {scopeWarning(draft.segment, usedValues(otherBooks(draft), (b) => b.segment))}
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Currency
                  <select aria-label={t("currency")} value={SUPPORTED_CURRENCIES.includes(draft.currency as (typeof SUPPORTED_CURRENCIES)[number]) ? draft.currency : "INR"} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={inputStyle}>
                    {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Geography
                  <input aria-label={t("geography")} list={`${headingId}-geographies`} value={draft.geography} onChange={(e) => setDraft({ ...draft, geography: e.target.value })} style={inputStyle} placeholder={t("geographyPlaceholder")} />
                  {scopeWarning(draft.geography, usedValues(otherBooks(draft), (b) => b.geography))}
                </label>
                <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  Channel
                  <input aria-label={t("channel")} list={`${headingId}-channels`} value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })} style={inputStyle} placeholder={t("channelPlaceholder")} />
                  {scopeWarning(draft.channel, usedValues(otherBooks(draft), (b) => b.channel))}
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 24 }}>
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              <div style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 4px" }}>Prices</div>
              <div style={{ display: "grid", gap: 6 }}>
                {entries.map((e, idx) => (
                  <div key={e.key} style={{ display: "grid", gridTemplateColumns: "1fr 140px 40px", gap: 6 }}>
                    <label className="sr-only" htmlFor={`${headingId}-ent-prod-${idx}`}>Product for entry {idx + 1}</label>
                    <select
                      id={`${headingId}-ent-prod-${idx}`}
                      value={e.productId}
                      onChange={(ev) => setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, productId: ev.target.value } : r)))}
                      style={inputStyle}
                    >
                      <option value="">Select product…</option>
                      {products.map((p) => {
                        const pid = p.id ?? "";
                        // Hide a product already used in another entry (but keep this
                        // row's own current selection visible), and flag inactive ones.
                        const usedElsewhere = pid !== "" && pid !== e.productId && entries.some((r, i) => i !== idx && r.productId === pid);
                        if (usedElsewhere) return null;
                        const selectable = isProductSelectable(p);
                        return (
                          <option key={p.id ?? p.code} value={pid} disabled={!selectable && pid !== e.productId}>
                            {p.name} ({p.code}){selectable ? "" : ` ${t("inactiveSuffix")}`}
                          </option>
                        );
                      })}
                    </select>
                    <label className="sr-only" htmlFor={`${headingId}-ent-price-${idx}`}>Price for entry {idx + 1}</label>
                    <input
                      id={`${headingId}-ent-price-${idx}`}
                      inputMode="decimal"
                      value={e.priceRupees}
                      aria-invalid={entryPriceInvalid(e) ? true : undefined}
                      onChange={(ev) => setEntries((prev) => prev.map((r, i) => (i === idx ? { ...r, priceRupees: ev.target.value } : r)))}
                      style={{ ...inputStyle, textAlign: "end" }}
                      placeholder="0.00"
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEntries((prev) => prev.filter((_, i) => i !== idx))} aria-label={`Remove entry ${idx + 1}`}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEntries((prev) => [...prev, newEntry()])}>
                  + Add price
                </Button>
                <span style={{ flex: 1 }} />
                <Button type="button" variant="ghost" onClick={() => { setDraft(null); setEditReason(null); }} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy || !draftValid(draft)}
                  aria-describedby={draftInvalidReason(draft) ? `${headingId}-save-reason` : undefined}
                >
                  {busy ? "Saving…" : draft.id ? "Save book" : "Create book"}
                </Button>
              </div>
              {draftInvalidReason(draft) ? (
                <p
                  id={`${headingId}-save-reason`}
                  style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0", textAlign: "end" }}
                >
                  {draftInvalidReason(draft)}
                </p>
              ) : null}
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
            <input aria-label={t("resolveSegment")} list={`${headingId}-segments`} value={rSegment} onChange={(e) => setRSegment(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Currency
            <select aria-label={t("resolveCurrency")} value={SUPPORTED_CURRENCIES.includes(rCurrency as (typeof SUPPORTED_CURRENCIES)[number]) ? rCurrency : "INR"} onChange={(e) => setRCurrency(e.target.value)} style={inputStyle}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Geography
            <input aria-label={t("resolveGeography")} list={`${headingId}-geographies`} value={rGeography} onChange={(e) => setRGeography(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
            Channel
            <input aria-label={t("resolveChannel")} list={`${headingId}-channels`} value={rChannel} onChange={(e) => setRChannel(e.target.value)} style={inputStyle} />
          </label>
          <Button type="button" onClick={() => void runResolve()} disabled={resolveSource === "loading"}>
            {resolveSource === "loading" ? "Resolving…" : "Resolve"}
          </Button>
        </div>
        <div style={{ padding: "0 12px 12px", fontSize: 14 }} aria-live="polite">
          {resolveSource === "idle" ? (
            <span style={{ color: "var(--muted)" }}>Enter criteria and resolve to see the applicable book.</span>
          ) : resolveSource === "error" ? (
            <span role="alert" style={{ color: "#b42318" }}>{t("resolveFailed")}</span>
          ) : resolved ? (
            <span>
              Applicable book: <strong>{resolved.name}</strong>{" "}
              <span style={{ color: "var(--muted)" }}>
                ({resolved.entries.length} price{resolved.entries.length === 1 ? "" : "s"}
                {resolved.entries.length > 0 ? `, e.g. ${formatMoneyIn(resolved.entries[0].priceMinor, resolved.currency)}` : ""})
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

      <ConfirmDialog
        open={confirmEditBook !== null}
        requireReason
        reasonLabel={t("editReasonLabel")}
        maxReasonLength={500}
        title={confirmEditBook ? t("editTitle", { name: confirmEditBook.name }) : ""}
        description={t("editDescription")}
        confirmLabel={t("editConfirm")}
        busy={busy}
        onCancel={() => setConfirmEditBook(null)}
        onConfirm={(reason) => {
          const b = confirmEditBook;
          setConfirmEditBook(null);
          // The reason is stored against the version this edit produces (change history).
          if (b) edit(b, reason);
        }}
      />
    </div>
  );
}
