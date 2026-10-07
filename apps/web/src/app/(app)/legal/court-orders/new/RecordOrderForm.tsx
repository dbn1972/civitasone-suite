"use client";

import { UserFacingError } from "@/lib/userFacingError";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

type CaseOption = { id: string; label: string };

/**
 * Records a court order against a case via POST /api/v1/legal/cases/:id/orders
 * (recordOrderBody: orderType, direction?, deptRef?, summary, orderDate).
 *
 * Recording an order is irreversible (it directs compliance), so submission is
 * gated behind an accessible ConfirmDialog that repeats which case, order type
 * and date are being filed (GAP-LEGAL-COURT-ORDERS-NEW-03).
 */
export function RecordOrderForm({ cases }: { cases: CaseOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // GAP-LEGAL-COURT-ORDERS-NEW-03: do NOT silently default to the first case
  // (a hurried submit then files against an unrelated case). Start empty and
  // force an explicit choice — unless opened with ?caseId= from a case page.
  const preselect = searchParams.get("caseId") ?? "";
  const initialCaseId = cases.some((c) => c.id === preselect) ? preselect : "";
  const [caseId, setCaseId] = useState(initialCaseId);
  const [orderType, setOrderType] = useState("order");
  const [summary, setSummary] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [direction, setDirection] = useState("");
  const [deptRef, setDeptRef] = useState("");
  const [complianceRequired, setComplianceRequired] = useState(false);
  const [complianceDeadline, setComplianceDeadline] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("court order");

  const selectedCase = useMemo(() => cases.find((c) => c.id === caseId), [cases, caseId]);

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const body = {
        orderType: orderType.trim() || "order",
        summary: summary.trim(),
        orderDate,
        direction: direction.trim() || undefined,
        deptRef: deptRef.trim() || undefined,
        complianceRequired,
        complianceDeadline: complianceRequired && complianceDeadline ? complianceDeadline : undefined,
      };
      const res = await fetch(`/api/proxy/v1/legal/cases/${encodeURIComponent(caseId)}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
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
        <p style={{ fontSize: 14, color: "var(--ink2)" }}>
          No cases are available yet. <Link href="/legal/cases/new" className="lnk">Register a case</Link> before recording an order.
        </p>
      </div>
    );
  }

  const confirmDescription = selectedCase
    ? `Record ${humanizeStatus(orderType)}${orderDate ? ` dated ${formatIndianDate(orderDate)}` : ""} against ${selectedCase.label}? This directs the owning department to comply and cannot be undone.`
    : "Recording an order directs the owning department to comply and cannot be undone. Confirm the details are correct.";

  return (
    <form onSubmit={handleSubmit} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="caseId">Case *</label>
          <select id="caseId" className="inp" value={caseId} onChange={(e) => setCaseId(e.target.value)} required style={{ minHeight: 44 }}>
            <option value="">Select a case…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="orderType">Order type *</label>
          <select id="orderType" className="inp" value={orderType} onChange={(e) => setOrderType(e.target.value)} style={{ minHeight: 44 }}>
            <option value="order">Order</option>
            <option value="judgment">Judgment</option>
            <option value="interim">Interim order</option>
            <option value="stay">Stay</option>
            <option value="direction">Direction</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="orderDate">Order date *</label>
          <input id="orderDate" type="date" className="inp" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="summary">Summary *</label>
          <textarea id="summary" className="inp" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={2000} placeholder="Operative directions of the order" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="direction">Direction / compliance action</label>
          <textarea id="direction" className="inp" rows={2} value={direction} onChange={(e) => setDirection(e.target.value)} maxLength={512} />
        </div>
        <div className="field">
          <label className="label" htmlFor="deptRef">Owning department</label>
          <input id="deptRef" className="inp" value={deptRef} onChange={(e) => setDeptRef(e.target.value)} style={{ minHeight: 44 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="complianceRequired" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="complianceRequired" type="checkbox" checked={complianceRequired} onChange={(e) => setComplianceRequired(e.target.checked)} />
            Compliance required
          </label>
        </div>
        {complianceRequired && (
          <div className="field">
            <label className="label" htmlFor="complianceDeadline">Comply by</label>
            <input id="complianceDeadline" type="date" className="inp" value={complianceDeadline} onChange={(e) => setComplianceDeadline(e.target.value)} style={{ minHeight: 44 }} />
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Saving…" : "Record order"}
        </Button>
        <Link href="/legal/court-orders" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>

      <ConfirmDialog
        open={open}
        title="Record this court order?"
        description={confirmDescription}
        confirmLabel="Record order"
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </form>
  );
}
