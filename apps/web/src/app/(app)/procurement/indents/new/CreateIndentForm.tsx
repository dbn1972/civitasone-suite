"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateIndentForm() {
  const router = useRouter();
  const [department, setDepartment] = useState("Finance");
  const [purpose, setPurpose] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!department.trim() || purpose.trim().length < 3 || !itemCode.trim() || !description.trim()) {
      setStatus("error");
      setMessage("Department, purpose (min 3 chars), item code and description are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const indentNo = `IND/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 900) + 100)}`;
    const body = {
      indentNo,
      department: department.trim(),
      purpose: purpose.trim(),
      requiredBy: requiredBy || undefined,
      items: [{
        itemCode: itemCode.trim(),
        description: description.trim(),
        quantity: Math.max(1, quantity),
        unit: "nos",
        unitPriceMinor: Math.max(0, Math.round(unitPrice * 100)),
      }],
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/indents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      setStatus("accepted");
      setMessage("Indent submitted for approval via workflow.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 640 }}>
      <div className="fields">
        <div className="field">
          <label className="label" htmlFor="department">Department</label>
          <input id="department" className="inp" value={department} onChange={(e) => setDepartment(e.target.value)} required />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="purpose">Purpose</label>
          <textarea id="purpose" className="inp" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="requiredBy">Required by</label>
          <input id="requiredBy" type="date" className="inp" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="itemCode">Item code</label>
          <input id="itemCode" className="inp" value={itemCode} onChange={(e) => setItemCode(e.target.value)} required />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="description">Item description</label>
          <input id="description" className="inp" value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="quantity">Quantity</label>
          <input id="quantity" type="number" min={1} className="inp" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label" htmlFor="unitPrice">Est. unit price (₹)</label>
          <input id="unitPrice" type="number" min={0} step="0.01" className="inp" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
        </div>
      </div>
      {message ? <p style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>{message}</p> : null}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit for approval"}
        </button>
        <Link href="/procurement/indents" className="btn ghost">Cancel</Link>
      </div>
    </form>
  );
}
