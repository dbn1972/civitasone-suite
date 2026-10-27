"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LineItemsEditor, emptyLineItem, lineItemsTotalMinor, lineUnitPriceMinor, isLineUnitPriceInvalid, type LineItem } from "../../_components/LineItemsEditor";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { Button, Field, Input } from "@/app/_components/ds";
import { formatMoney, todayIST } from "@/lib/formatters";
import { minorToRupeesInput } from "@/lib/money";
import { RemoteSearchSelect, type RemoteOption, type RemoteSearchState } from "../../_components/RemoteSearchSelect";

type VendorOption = { id: string; name: string; blacklisted?: boolean; kycStatus?: string };
type IndentOption = { id: string; indentNo?: string; department?: string; status?: string; totalMinor?: string | number };
type IndentLine = { itemCode?: string; itemName?: string; description?: string; quantity?: number; unit?: string; unitPriceMinor?: number };

// GAP-PROCUREMENT-ORDERS-NEW-04: the GFR band the PO total falls in (same
// lookup the indent form uses; the API carries i18n keys, not English prose).
type GfrBand = { id: string; nameKey: string; notesKey: string; requiresTender: boolean };
type ModeState = "idle" | "loading" | "ready" | "error";
type CopyState = "idle" | "loading" | "error" | "empty";

/** Machine `code` of a JSON error body, or undefined when the body is not JSON. */
function errorCode(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "code" in parsed) {
      const c = (parsed as { code?: unknown }).code;
      return typeof c === "string" ? c : undefined;
    }
  } catch { /* not JSON */ }
  return undefined;
}

export function CreatePOForm() {
  const router = useRouter();
  const t = useTranslations();
  const tw = useTranslations("procurement.w2");
  const tv = useTranslations("procurement.vendorPicker");
  const [vendor, setVendor] = useState<RemoteOption | null>(null);
  const [vendorState, setVendorState] = useState<RemoteSearchState>("idle");
  const [indent, setIndent] = useState<RemoteOption | null>(null);
  const [indentState, setIndentState] = useState<RemoteSearchState>("idle");
  // The sanctioned value of each indent seen in the picker, remembered by id.
  const indentTotals = useRef(new Map<string, number>());
  const [deliveryDate, setDeliveryDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("purchase order");
  const [modeBand, setModeBand] = useState<GfrBand | null>(null);
  const [modeState, setModeState] = useState<ModeState>("idle");
  const [modeNonce, setModeNonce] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // D4c #28: a vendor with no empanelment record needs an awarded-tender / GeM basis.
  // The section appears when the server says so (422 VENDOR_NOT_EMPANELLED).
  const [needsBasis, setNeedsBasis] = useState(false);
  const [tenderId, setTenderId] = useState("");
  const [gemOrderRef, setGemOrderRef] = useState("");
  const [tenders, setTenders] = useState<Array<{ id: string; label: string }>>([]);
  const [tendersFailed, setTendersFailed] = useState(false);

  const today = todayIST();
  const vendorId = vendor?.id ?? "";
  const indentId = indent?.id ?? "";

  // GAP-PROCUREMENT-ORDERS-NEW-03: server-side search (?q=), 25 per query, in
  // place of one plain <select> over limit=200 (a larger register was
  // unreachable). A failed request THROWS so the picker shows an error with
  // Retry - never an empty list or a perpetual "Loading...".
  const searchVendors = useCallback(async (q: string, signal: AbortSignal): Promise<RemoteOption[]> => {
    const qs = new URLSearchParams({ limit: "25" });
    if (q) qs.set("q", q);
    const res = await fetch(`/api/proxy/v1/procurement/vendors?${qs.toString()}`, { signal });
    if (!res.ok) throw new Error("vendor search failed");
    const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    // GAP-PROCUREMENT-ORDERS-NEW-01: never offer a blacklisted vendor. The server
    // also rejects one synchronously (422 VENDOR_BLACKLISTED); this removes the
    // dead option up front.
    return rows
      .filter((v) => v.id && v.name && !v.blacklisted)
      .map((v) => ({ id: v.id, label: v.name, ...(v.kycStatus && v.kycStatus !== "verified" ? { hint: `KYC: ${v.kycStatus}` } : {}) }));
  }, []);

  const searchIndents = useCallback(async (q: string, signal: AbortSignal): Promise<RemoteOption[]> => {
    const qs = new URLSearchParams({ limit: "25", status: "approved" });
    if (q) qs.set("q", q);
    const res = await fetch(`/api/proxy/v1/procurement/indents?${qs.toString()}`, { signal });
    if (!res.ok) throw new Error("indent search failed");
    const body = await res.json() as { data?: IndentOption[] } | IndentOption[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    // GAP-PROCUREMENT-ORDERS-NEW-01: only an APPROVED indent can back a PO.
    const clean = rows.filter((i) => i.id && (i.status ? i.status === "approved" : true));
    for (const i of clean) if (i.totalMinor != null) indentTotals.current.set(i.id, Number(i.totalMinor));
    return clean.map((i) => {
      const hint = [i.department, i.totalMinor != null ? formatMoney(Number(i.totalMinor)) : null].filter(Boolean).join(" · ");
      return { id: i.id, label: i.indentNo ?? i.id, ...(hint ? { hint } : {}) };
    });
  }, []);

  const poTotalMinor = lineItemsTotalMinor(items);
  const indentTotalMinor = indentId ? (indentTotals.current.get(indentId) ?? null) : null;
  // GAP-PROCUREMENT-ORDERS-NEW-04: reconcile PO total against the sanctioned
  // indent value. Exceeding it is a block (overspend against a sanctioned indent).
  const exceedsIndent = indentTotalMinor != null && poTotalMinor > indentTotalMinor;

  // GAP-PROCUREMENT-ORDERS-NEW-04: the GFR band for the PO total. A failed lookup
  // is reported as such (the tender-requirement check did not run), never as a
  // perpetual "determining".
  useEffect(() => {
    if (poTotalMinor <= 0) { setModeBand(null); setModeState("idle"); return; }
    const controller = new AbortController();
    setModeState("loading");
    fetch(`/api/proxy/v1/procurement/gfr/mode-bands?estimatedValueMinor=${poTotalMinor}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`mode-bands lookup failed: ${r.status}`);
        return r.json() as Promise<{ data: GfrBand[]; applicableMode?: string }>;
      })
      .then((json) => {
        const id = json.applicableMode;
        setModeBand(id ? (json.data.find((b) => b.id === id) ?? null) : null);
        setModeState("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setModeBand(null);
        setModeState("error");
      });
    return () => controller.abort();
  }, [poTotalMinor, modeNonce]);

  // GAP-PROCUREMENT-ORDERS-NEW-04: optional prefill - copies the sanctioned
  // indent's lines into the PO; the officer then edits quantities / prices.
  async function copyLinesFromIndent() {
    if (!indentId) return;
    setCopyState("loading");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/indents/${indentId}`);
      if (!res.ok) { setCopyState("error"); return; }
      const body = await res.json() as { lineItems?: IndentLine[] };
      const lines = (body.lineItems ?? []).filter((l) => (l.itemCode ?? "").trim() && (l.itemName ?? l.description ?? "").trim());
      if (lines.length === 0) { setCopyState("empty"); return; }
      setItems(lines.map((l) => ({
        itemCode: l.itemCode ?? "",
        description: l.itemName ?? l.description ?? "",
        quantity: Math.max(1, Math.trunc(l.quantity ?? 1)),
        unit: l.unit || "nos",
        // exact paise -> rupees string, no float: 12345 -> "123.45"
        unitPrice: l.unitPriceMinor != null ? minorToRupeesInput(l.unitPriceMinor) : "",
      })));
      setCopyState("idle");
    } catch {
      setCopyState("error");
    }
  }

  useEffect(() => {
    if (!needsBasis) return;
    const controller = new AbortController();
    fetch("/api/proxy/v1/procurement/tenders?limit=100", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("tender list failed");
        const body = await res.json() as { data?: Array<{ id?: string; tenderNo?: string; title?: string; status?: string }> } | Array<{ id?: string; tenderNo?: string; title?: string; status?: string }>;
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        setTenders(rows.filter((r) => r.id && r.status === "awarded").map((r) => ({ id: r.id as string, label: [r.tenderNo, r.title].filter(Boolean).join(" — ") })));
        setTendersFailed(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setTenders([]);
        setTendersFailed(true);
      });
    return () => controller.abort();
  }, [needsBasis]);

  // Submit waits for the pickers to be usable: a picker whose search failed must
  // be retried, not silently bypassed.
  const listsReady = vendorState !== "error" && indentState !== "error";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());
    if (!vendorId || !indentId || validItems.length === 0) {
      setStatus("error");
      setMessage(tw("po.chooseBoth"));
      return;
    }
    // GAP2-PROCUREMENT-MONEY-WEB-04: reject any invalid unit price (>2 decimals
    // / non-numeric) up front rather than silently rounding a committed PO total.
    if (validItems.some((it) => isLineUnitPriceInvalid(it.unitPrice))) {
      setStatus("error");
      setMessage("One or more line items have an invalid unit price — enter rupees with at most 2 decimal places.");
      return;
    }
    if (deliveryDate && deliveryDate < today) {
      setStatus("error");
      setMessage("Delivery date cannot be in the past.");
      return;
    }
    if (exceedsIndent) {
      setStatus("error");
      setMessage("The PO total exceeds the sanctioned indent value. Reduce the lines or choose a larger indent.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    // GAP-PROCUREMENT-ORDERS-NEW-02: the PO number is issued by the server from
    // a per-tenant, per-FY gapless sequence — never generated in the browser.
    const body = {
      vendorId,
      indentRef: `procurement_indent:${indentId}`,
      deliveryDate: deliveryDate || undefined,
      ...(tenderId ? { tenderId } : {}),
      ...(gemOrderRef.trim() ? { gemOrderRef: gemOrderRef.trim() } : {}),
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: it.unit || "nos",
        // GAP2-PROCUREMENT-MONEY-WEB-04: exact paise from the rupees STRING via
        // BigInt, never `Math.round(float * 100)`.
        unitPriceMinor: Number(lineUnitPriceMinor(it.unitPrice) ?? 0n),
      })),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/pos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        // 422 VENDOR_BLACKLISTED: the vendor was blacklisted/debarred after this
        // page loaded. Show a fixed, translated message -- never the raw server text.
        if (res.status === 422 && errorCode(text) === "VENDOR_BLACKLISTED") {
          setMessage(t("procurement.poForm.vendorBlacklisted"));
          return;
        }
        // D4c #28: no empanelment record -> ask for an awarded tender / GeM reference.
        if (res.status === 422 && errorCode(text) === "VENDOR_NOT_EMPANELLED") {
          setNeedsBasis(true);
          setMessage(t("procurement.poForm.vendorNotEmpanelled"));
          return;
        }
        const human = toHumanError("save", { area: "purchase order" });
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      // GAP-PROCUREMENT-ORDERS-DETAIL-01: a PO is created as a draft; the single
      // release path (eOffice approval) is raised from the PO page, so do not claim
      // it was already submitted for workflow approval.
      setMessage(t("procurement.poForm.created"));
      router.push(parsed.id ? `/procurement/orders/${parsed.id}` : "/procurement/orders");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(formError.fromException("save", err).message);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <Field id="po-vendor" label="Vendor *">
          <RemoteSearchSelect
            inputId="po-vendor"
            value={vendor}
            onChange={setVendor}
            search={searchVendors}
            onStateChange={setVendorState}
            required
            labels={{ placeholder: tv("placeholder"), loading: tv("loading"), empty: tv("empty"), error: tv("error"), retry: tv("retry"), clear: tv("clear") }}
          />
        </Field>

        <Field id="po-indent" label="Source indent (approved) *">
          <RemoteSearchSelect
            inputId="po-indent"
            value={indent}
            onChange={(next) => { setIndent(next); setCopyState("idle"); }}
            search={searchIndents}
            onStateChange={setIndentState}
            required
            labels={{
              placeholder: tw("indentPicker.placeholder"), loading: tw("indentPicker.loading"), empty: tw("indentPicker.empty"),
              error: tw("indentPicker.error"), retry: tw("indentPicker.retry"), clear: tw("indentPicker.clear"),
            }}
          />
        </Field>

        {needsBasis ? (
          <fieldset style={{ gridColumn: "1 / -1", border: "1px solid var(--bd)", borderRadius: 8, padding: 12 }}>
            <legend style={{ fontWeight: 600, fontSize: "0.875rem" }}>{t("procurement.poForm.basisTitle")}</legend>
            <Field id="po-basis-tender" label={t("procurement.poForm.tenderLabel")}>
              <select id="po-basis-tender" className="inp" value={tenderId} onChange={(e) => setTenderId(e.target.value)}>
                <option value="">{t("procurement.poForm.tenderNone")}</option>
                {tenders.map((tn) => <option key={tn.id} value={tn.id}>{tn.label}</option>)}
              </select>
              {tendersFailed ? <span role="alert" style={{ fontSize: "0.8125rem", color: "var(--bad)" }}>{t("procurement.poForm.tendersFailed")}</span> : null}
            </Field>
            <Field id="po-basis-gem" label={t("procurement.poForm.gemRefLabel")}>
              <Input id="po-basis-gem" value={gemOrderRef} maxLength={128} onChange={(e) => setGemOrderRef(e.target.value)} />
            </Field>
          </fieldset>
        ) : null}

        <Field label="Delivery date">
          <Input
            type="date"
            value={deliveryDate}
            min={today}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </Field>
      </div>

      {indentId ? (
        <div style={{ margin: "8px 0" }}>
          <Button type="button" variant="ghost" onClick={() => void copyLinesFromIndent()} disabled={copyState === "loading"}>
            {copyState === "loading" ? tw("po.copying") : tw("po.copyFromIndent")}
          </Button>
          {copyState === "error" ? <span role="alert" style={{ marginInlineStart: 8, color: "var(--bad)", fontSize: "0.8125rem" }}>{tw("po.copyFailed")}</span> : null}
          {copyState === "empty" ? <span role="status" style={{ marginInlineStart: 8, fontSize: "0.8125rem" }}>{tw("po.copyEmpty")}</span> : null}
        </div>
      ) : null}

      <LineItemsEditor items={items} onChange={setItems} />

      {/* GAP-PROCUREMENT-ORDERS-NEW-04: GFR procurement-mode band for the PO total. */}
      {poTotalMinor > 0 ? (
        <div style={{ margin: "12px 0", fontSize: "0.875rem" }} data-testid="po-mode-band">
          <span style={{ fontWeight: 600 }}>{tw("po.modeBand")}: </span>
          {modeState === "ready" && modeBand ? (
            <span>
              <span className="pill">{modeBand.id}</span>{" "}
              {t(modeBand.nameKey)} — {t(modeBand.notesKey)}
            </span>
          ) : modeState === "loading" ? (
            <span>{tw("po.modeLoading")}</span>
          ) : modeState === "error" ? (
            <span role="alert" style={{ color: "var(--bad)" }}>
              {tw("po.modeError")}{" "}
              <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setModeNonce((n) => n + 1)}>{tv("retry")}</button>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* GAP-PROCUREMENT-ORDERS-NEW-04: indent-value reconciliation. */}
      {indentTotalMinor != null && (
        <div style={{ margin: "12px 0", fontSize: "0.875rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>PO total</span><span className="mono">{formatMoney(poTotalMinor)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Sanctioned indent value</span><span className="mono">{formatMoney(indentTotalMinor)}</span>
          </div>
          {exceedsIndent ? (
            <p role="alert" style={{ margin: "6px 0 0", color: "var(--bad)" }}>
              PO total exceeds the sanctioned indent value — reduce the lines or choose a larger indent.
            </p>
          ) : null}
        </div>
      )}

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting" || !listsReady || exceedsIndent}>
          {status === "submitting" ? "Submitting…" : "Create PO"}
        </Button>
        <Link href="/procurement/orders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
