"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, Modal } from "@/app/_components/ds";
import { useAuditT } from "@/lib/audit/useAuditT";
import { formatIndianDate } from "@/lib/formatters";

export function PlanAuditButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("audit plan");
  const t = useAuditT();
  // GAP-AUDIT-PLAN-05: confirm gate summarising the plan before the create mutation.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [planNo, setPlanNo] = useState("");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  // Validate BEFORE showing the confirm dialog (GAP-AUDIT-PLAN-05).
  const handleProceed = useCallback(() => {
    setError(null);
    if (!planNo.trim() || !title.trim() || !area.trim() || !periodFrom || !periodTo) {
      setError("Plan no., title, area and both dates are required.");
      return;
    }
    // GAP-AUDIT-PLAN-04: the date inputs set max/min, but typed/pasted/
    // programmatic values can still invert the range, so enforce it here too.
    if (periodTo < periodFrom) {
      setError("Planned-to must be on or after planned-from.");
      return;
    }
    setConfirmOpen(true);
  }, [planNo, title, area, periodFrom, periodTo]);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/audit/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planNo: planNo.trim(),
          title: title.trim(),
          area: area.trim(),
          periodFrom,
          periodTo,
          riskLevel,
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setConfirmOpen(false);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [planNo, title, area, periodFrom, periodTo, riskLevel, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Plan Audit</Button>
      {/* SF-19: ds/Modal (focus trap, inert background, Escape). Overlay click never discards typed input. */}
      <Modal open={open} onClose={() => { if (!confirmOpen) close(); }} title="Plan audit engagement" size="lg" closeOnOverlayClick={false}>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="lbl" htmlFor="ps-no">Plan no.</label>
              <input id="ps-no" className="inp" value={planNo} onChange={(e) => setPlanNo(e.target.value)} placeholder="PLAN-FY26-03" />
              {formError.fieldError("planNo") && (
                <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("planNo")}</span>
              )}
              <label className="lbl" htmlFor="ps-title">Title</label>
              <input id="ps-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Procurement compliance audit" />
              {formError.fieldError("title") && (
                <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("title")}</span>
              )}
              <label className="lbl" htmlFor="ps-area">Audit area / unit</label>
              <input id="ps-area" className="inp" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Procurement Wing" />
              {formError.fieldError("area") && (
                <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("area")}</span>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="ps-from">Planned from</label>
                  <input id="ps-from" type="date" className="inp" value={periodFrom} max={periodTo || undefined} onChange={(e) => setPeriodFrom(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="ps-to">Planned to</label>
                  <input id="ps-to" type="date" className="inp" value={periodTo} min={periodFrom || undefined} onChange={(e) => setPeriodTo(e.target.value)} />
                </div>
              </div>
              <label className="lbl" htmlFor="ps-risk">Risk level</label>
              <select id="ps-risk" className="inp" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as typeof riskLevel)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                <Button onClick={handleProceed} disabled={busy}>{busy ? "Planning…" : "Plan audit"}</Button>
              </div>
            </div>
          </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title={t("planConfirmTitle", { planNo: planNo.trim() })}
        description={t("planConfirmDescription", {
          title: title.trim(),
          area: area.trim(),
          from: periodFrom ? formatIndianDate(periodFrom) : "",
          to: periodTo ? formatIndianDate(periodTo) : "",
          risk: riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1),
        })}
        confirmLabel={t("planConfirmLabel")}
        cancelLabel={t("cancel")}
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={() => void submit()}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
