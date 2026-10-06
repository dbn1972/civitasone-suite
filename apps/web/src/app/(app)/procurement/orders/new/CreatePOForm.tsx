"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LineItemsEditor, emptyLineItem, lineItemsTotalMinor, type LineItem } from "../../_components/LineItemsEditor";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { Button, Field, Select, Input } from "@/app/_components/ds";
import { formatMoney, todayIST } from "@/lib/formatters";

type VendorOption = { id: string; name: string; blacklisted?: boolean; kycStatus?: string };
type IndentOption = { id: string; indentNo?: string; department?: string; status?: string; totalMinor?: string | number };

type LoadState = "loading" | "ready" | "error" | "empty";

export function CreatePOForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorState, setVendorState] = useState<LoadState>("loading");
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [indentId, setIndentId] = useState("");
  const [indentState, setIndentState] = useState<LoadState>("loading");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("purchase order");
  const [reloadTick, setReloadTick] = useState(0);

  const today = todayIST();

  useEffect(() => {
    const controller = new AbortController();
    setVendorState("loading");
    setIndentState("loading");
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=200", { signal: controller.signal });
        if (!res.ok) { setVendorState("error"); return; }
        const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        // GAP-PROCUREMENT-ORDERS-NEW-01: never offer a blacklisted vendor. The
        // server also rejects one (422), this just removes the dead option.
        const clean = rows.filter((v) => v.id && v.name && !v.blacklisted);
        setVendors(clean);
        setVendorState(clean.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setVendorState("error");
      }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/indents?limit=200", { signal: controller.signal });
        if (!res.ok) { setIndentState("error"); return; }
        const body = await res.json() as { data?: IndentOption[] } | IndentOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        // GAP-PROCUREMENT-ORDERS-NEW-01: only an APPROVED indent can back a PO.
        const clean = rows.filter((i) => i.id && (i.status ? i.status === "approved" : true));
        setIndents(clean);
        setIndentState(clean.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setIndentState("error");
      }
    })();
    return () => controller.abort();
  }, [reloadTick]);

  const selectedIndent = useMemo(() => indents.find((i) => i.id === indentId), [indents, indentId]);
  const poTotalMinor = lineItemsTotalMinor(items);
  const indentTotalMinor = selectedIndent?.totalMinor != null ? Number(selectedIndent.totalMinor) : null;
  // GAP-PROCUREMENT-ORDERS-NEW-04: reconcile PO total against the sanctioned
  // indent value. Exceeding it is a block (overspend against a sanctioned indent).
  const exceedsIndent = indentTotalMinor != null && poTotalMinor > indentTotalMinor;

  const listsReady = vendorState === "ready" && indentState === "ready";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());
    if (!vendorId || !indentId || validItems.length === 0) {
      setStatus("error");
      setMessage("Choose a vendor and an approved indent, and add at least one complete line item.");
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
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: it.unit || "nos",
        unitPriceMinor: Math.max(0, Math.round(it.unitPrice * 100)),
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
        const human = toHumanError("save", { area: "purchase order" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      setMessage("PO submitted for workflow approval.");
      router.push(parsed.id ? `/procurement/orders/${parsed.id}` : "/procurement/orders");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(formError.fromException("save", err).message);
    }
  }

  function renderListState(state: LoadState, noun: string) {
    if (state === "error") {
      return (
        <p role="alert" style={{ margin: "4px 0 0", color: "var(--bad)", fontSize: "0.8125rem" }}>
          Couldn’t load {noun}.{" "}
          <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setReloadTick((t) => t + 1)}>Retry</button>
        </p>
      );
    }
    if (state === "empty") {
      return <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "0.8125rem" }}>No {noun} available.</p>;
    }
    return null;
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <Field label="Vendor *">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required disabled={vendorState !== "ready"}>
            <option value="" disabled>{vendorState === "loading" ? "Loading vendors…" : "Select a vendor…"}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.kycStatus && v.kycStatus !== "verified" ? ` (KYC: ${v.kycStatus})` : ""}</option>
            ))}
          </Select>
          {renderListState(vendorState, "vendors")}
        </Field>

        <Field label="Source indent (approved) *">
          <Select value={indentId} onChange={(e) => setIndentId(e.target.value)} required disabled={indentState !== "ready"}>
            <option value="" disabled>{indentState === "loading" ? "Loading indents…" : "Select an approved indent…"}</option>
            {indents.map((i) => (
              <option key={i.id} value={i.id}>
                {i.indentNo ?? i.id}{i.department ? ` — ${i.department}` : ""}{i.totalMinor != null ? ` (${formatMoney(Number(i.totalMinor))})` : ""}
              </option>
            ))}
          </Select>
          {renderListState(indentState, "approved indents")}
        </Field>

        <Field label="Delivery date">
          <Input
            type="date"
            value={deliveryDate}
            min={today}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </Field>
      </div>

      <LineItemsEditor items={items} onChange={setItems} />

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
