"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, useConfirmAction } from "../../../../_components/ds";

type CaseOption = { id: string; label: string };

/**
 * Records a court order against a case via POST /api/v1/legal/cases/:id/orders
 * (recordOrderBody: orderType, direction?, deptRef?, summary, orderDate).
 *
 * Recording an order is irreversible (it directs compliance), so submission is
 * gated behind an accessible ConfirmDialog (maker-checker).
 */
export function RecordOrderForm({ cases }: { cases: CaseOption[] }) {
  const router = useRouter();
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [orderType, setOrderType] = useState("order");
  const [summary, setSummary] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [direction, setDirection] = useState("");
  const [deptRef, setDeptRef] = useState("");
  const [message, setMessage] = useState("");

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const body = {
        orderType: orderType.trim() || "order",
        summary: summary.trim(),
        orderDate,
        direction: direction.trim() || undefined,
        deptRef: deptRef.trim() || undefined,
      };
      const res = await fetch(`/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
    },
    onSuccess: () => {
      router.push("/legal/court-orders");
      router.refresh();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) {
      setMessage("Select a case to record the order against.");
      return;
    }
    if (summary.trim().length < 1 || !orderDate) {
      setMessage("Order summary and order date are required.");
      return;
    }
    setMessage("");
    trigger();
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
    <form onSubmit={handleSubmit} className="card pad" style={{ maxWidth: 820 }} noValidate>
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
          <p role="alert" style={{ marginTop: 12, color: "#b91c1c", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Saving…" : "Record order"}
        </button>
        <Link href="/legal/court-orders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>

      <ConfirmDialog
        open={open}
        title="Record this court order?"
        description="Recording an order directs the owning department to comply and cannot be undone. Confirm the details are correct."
        confirmLabel="Record order"
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </form>
  );
}
