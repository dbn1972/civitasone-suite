"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LineItemsEditor, emptyLineItem, type LineItem } from "../../_components/LineItemsEditor";

type VendorOption = { id: string; name: string };
type IndentOption = { id: string; indentNo?: string; department?: string };

export function CreatePOForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [indentId, setIndentId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100");
        if (!res.ok) return;
        const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const clean = rows.filter((v) => v.id && v.name);
        setVendors(clean);
        if (clean[0]?.id) setVendorId(clean[0].id);
      } catch { /* optional */ }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/indents?limit=100");
        if (!res.ok) return;
        const body = await res.json() as { data?: IndentOption[] } | IndentOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        const clean = rows.filter((i) => i.id);
        setIndents(clean);
        if (clean[0]?.id) setIndentId(clean[0].id);
      } catch { /* optional */ }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());
    if (!vendorId || !indentId || validItems.length === 0) {
      setStatus("error");
      setMessage("Vendor, source indent and at least one complete line item are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const poNo = `PO/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      poNo,
      vendorId,
      indentRef: `procurement_indent:${indentId}`,
      deliveryDate: deliveryDate || undefined,
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: "nos",
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
        setStatus("error");
        setMessage(text || `Create failed (${res.status})`);
        return;
      }
      const parsed = JSON.parse(text) as { id?: string };
      setStatus("accepted");
      setMessage("PO submitted for workflow approval.");
      router.push(parsed.id ? `/procurement/orders/${parsed.id}` : "/procurement/orders");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Vendor *</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required style={{ minHeight: 44 }}>
            {vendors.length === 0 ? <option value="">Loading vendors…</option> : null}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Source indent *</span>
          <select value={indentId} onChange={(e) => setIndentId(e.target.value)} required style={{ minHeight: 44 }}>
            {indents.length === 0 ? <option value="">Loading indents…</option> : null}
            {indents.map((i) => (
              <option key={i.id} value={i.id}>{i.indentNo ?? i.id}{i.department ? ` — ${i.department}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Delivery date</span>
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      <LineItemsEditor items={items} onChange={setItems} />

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Create PO"}
        </button>
        <Link href="/procurement/orders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
