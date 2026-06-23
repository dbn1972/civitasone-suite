"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type VendorOption = { id: string; name: string };

export function CreatePOForm() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [indentRef, setIndentRef] = useState("procurement_indent:11111111-0002-0000-0000-000000000001");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100");
        if (!res.ok) return;
        const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
        const rows = Array.isArray(body) ? body : (body.data ?? []);
        setVendors(rows.filter((v) => v.id && v.name));
        if (rows[0]?.id) setVendorId(rows[0].id);
      } catch {
        /* optional */
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId || indentRef.trim().length < 1 || !itemCode.trim() || !description.trim()) {
      setStatus("error");
      setMessage("Vendor, indent reference, item code and description are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const poNo = `PO/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      poNo,
      vendorId,
      indentRef: indentRef.trim(),
      deliveryDate: deliveryDate || undefined,
      items: [{
        itemCode: itemCode.trim(),
        description: description.trim(),
        quantity: Math.max(1, quantity),
        unit: "nos",
        unitPriceMinor: Math.max(0, Math.round(unitPrice * 100)),
      }],
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
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 640 }}>
      <div className="fields">
        <label className="field">
          <span className="label">Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            {vendors.length === 0 ? <option value="">Loading vendors…</option> : null}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Indent reference</span>
          <input value={indentRef} onChange={(e) => setIndentRef(e.target.value)} placeholder="procurement_indent:UUID" required />
        </label>
        <label className="field">
          <span className="label">Delivery date</span>
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Item code</span>
          <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} required />
        </label>
        <label className="field">
          <span className="label">Quantity</span>
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="label">Unit price (₹)</span>
          <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
        </label>
      </div>
      {message ? (
        <p style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
      ) : null}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Create PO"}
        </button>
        <Link href="/procurement/orders" className="btn ghost">Cancel</Link>
      </div>
    </form>
  );
}
