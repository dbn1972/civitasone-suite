"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CaseOption = { id: string; label: string };

/**
 * Records a court order against a case via POST /api/v1/legal/cases/:id/orders
 * (recordOrderBody: orderType, direction?, deptRef?, summary, orderDate).
 */
export function RecordOrderForm({ cases }: { cases: CaseOption[] }) {
  const router = useRouter();
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [orderType, setOrderType] = useState("order");
  const [summary, setSummary] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [direction, setDirection] = useState("");
  const [deptRef, setDeptRef] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) {
      setStatus("error");
      setMessage("Select a case to record the order against.");
      return;
    }
    if (summary.trim().length < 1 || !orderDate) {
      setStatus("error");
      setMessage("Order summary and order date are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      orderType: orderType.trim() || "order",
      summary: summary.trim(),
      orderDate,
      direction: direction.trim() || undefined,
      deptRef: deptRef.trim() || undefined,
    };
    try {
      const res = await fetch(`/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/orders`, {
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
      router.push("/legal/court-orders");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  if (cases.length === 0) {
    return (
      <div className="card pad" style={{ maxWidth: 820 }}>
        <p style={{ fontSize: 14, color: "#475467" }}>
          No cases are available yet. <Link href="/legal/cases/new" className="lnk">Register a case</Link> before recording an order.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="caseId">Case *</label>
          <select id="caseId" className="inp" value={caseId} onChange={(e) => setCaseId(e.target.value)} required style={{ minHeight: 44 }}>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="orderType">Order type *</label>
          <select id="orderType" className="inp" value={orderType} onChange={(e) => setOrderType(e.target.value)} style={{ minHeight: 44 }}>
            <option value="order">Order</option>
            <option value="judgment">Judgment</option>
            <option value="interim">Interim order</option>
            <option value="stay">Stay</option>
            <option value="direction">Direction</option>
          </select>
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="orderDate">Order date *</label>
          <input id="orderDate" type="date" className="inp" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="summary">Summary *</label>
          <textarea id="summary" className="inp" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={2000} placeholder="Operative directions of the order" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="direction">Direction / compliance action</label>
          <textarea id="direction" className="inp" rows={2} value={direction} onChange={(e) => setDirection(e.target.value)} maxLength={512} />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="deptRef">Owning department</label>
          <input id="deptRef" className="inp" value={deptRef} onChange={(e) => setDeptRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Record order"}
        </button>
        <Link href="/legal/court-orders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
