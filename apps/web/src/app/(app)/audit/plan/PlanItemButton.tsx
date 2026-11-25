"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, Modal } from "@/app/_components/ds";
import { useAuditT } from "@/lib/audit/useAuditT";

interface PlanOption { id: string; planNo: string; title: string }

/**
 * GAP-AUDIT-PLAN-01: adds an item to an existing audit plan via
 * POST /v1/audit/plans/:id/items (audit-service plan/routes.ts; body per
 * createPlanItemBody: deptRef, unitRef?, scheduledFrom, scheduledTo).
 * Role gating (AUDIT_PLAN_WRITE_ROLES) is applied by the page; the server stays the authority.
 */
export function PlanItemButton() {
  const router = useRouter();
  const t = useAuditT();
  const formError = useFormError("audit plan item");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [deptRef, setDeptRef] = useState("");
  const [unitRef, setUnitRef] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const openDialog = useCallback(async () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/audit/plans");
      if (!res.ok) { setError(t("planItemLoadError")); setPlans(null); return; }
      const json = (await res.json()) as { data?: PlanOption[] };
      setPlans(Array.isArray(json.data) ? json.data : []);
    } catch {
      setError(t("planItemLoadError"));
      setPlans(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const close = useCallback(() => { if (!busy) { setOpen(false); setError(null); } }, [busy]);

  const submit = useCallback(async () => {
    setError(null);
    if (!planId || !deptRef.trim() || !from || !to) { setError(t("planItemRequired")); return; }
    if (to < from) { setError(t("planItemDateOrder")); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/audit/plans/${encodeURIComponent(planId)}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deptRef: deptRef.trim(),
          ...(unitRef.trim() ? { unitRef: unitRef.trim() } : {}),
          scheduledFrom: from,
          scheduledTo: to,
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      setPlanId(""); setDeptRef(""); setUnitRef(""); setFrom(""); setTo("");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formError helpers are stable; the wrapper object is not read.
  }, [planId, deptRef, unitRef, from, to, router, t]);

  return (
    <>
      <Button variant="ghost" onClick={() => void openDialog()}>{t("planItemAdd")}</Button>
      <Modal open={open} onClose={close} title={t("planItemTitle")} size="lg" closeOnOverlayClick={false}>
        <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {loading ? (
            <div role="status">{t("planItemLoading")}</div>
          ) : plans !== null && plans.length === 0 ? (
            <div role="status">{t("planItemNoPlans")}</div>
          ) : (
            <>
              <label className="lbl" htmlFor="pi-plan">{t("planItemPlan")}</label>
              <select id="pi-plan" className="inp" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={plans === null}>
                <option value="">{t("planItemPlanPlaceholder")}</option>
                {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.planNo} — {p.title}</option>)}
              </select>
              <label className="lbl" htmlFor="pi-dept">{t("planItemDept")}</label>
              <input id="pi-dept" className="inp" value={deptRef} maxLength={128} onChange={(e) => setDeptRef(e.target.value)} />
              <label className="lbl" htmlFor="pi-unit">{t("planItemUnit")}</label>
              <input id="pi-unit" className="inp" value={unitRef} maxLength={128} onChange={(e) => setUnitRef(e.target.value)} />
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="pi-from">{t("planItemFrom")}</label>
                  <input id="pi-from" type="date" className="inp" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl" htmlFor="pi-to">{t("planItemTo")}</label>
                  <input id="pi-to" type="date" className="inp" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            </>
          )}
          {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <Button variant="ghost" onClick={close} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={() => void submit()} disabled={busy || loading || !plans || plans.length === 0}>
              {busy ? t("planItemSaving") : t("planItemSave")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
