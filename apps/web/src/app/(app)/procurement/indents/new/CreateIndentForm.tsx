"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LineItemsEditor, emptyLineItem, type LineItem } from "../../_components/LineItemsEditor";

export function CreateIndentForm() {
  const router = useRouter();
  const [department, setDepartment] = useState("Finance");
  const [purpose, setPurpose] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.itemCode.trim() && it.description.trim());
    if (!department.trim() || purpose.trim().length < 3 || validItems.length === 0) {
      setStatus("error");
      setMessage("Department, purpose (min 3 chars) and at least one complete line item are required.");
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
      items: validItems.map((it) => ({
        itemCode: it.itemCode.trim(),
        description: it.description.trim(),
        quantity: Math.max(1, it.quantity),
        unit: "nos",
        unitPriceMinor: Math.max(0, Math.round(it.unitPrice * 100)),
      })),
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
      router.push("/procurement/indents");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="department">Department *</label>
          <input id="department" className="inp" value={department} onChange={(e) => setDepartment(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="requiredBy">Required by</label>
          <input id="requiredBy" type="date" className="inp" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="purpose">Purpose *</label>
          <textarea id="purpose" className="inp" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
        </div>
      </div>

      <LineItemsEditor items={items} onChange={setItems} />

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit for approval"}
        </button>
        <Link href="/procurement/indents" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
