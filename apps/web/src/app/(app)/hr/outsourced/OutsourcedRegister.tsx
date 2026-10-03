"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, DataTable, Drawer, StatusPill } from "../../../_components/ds";
import { parseRupeesToPaise } from "@/lib/money";
import { useFormError } from "@/lib/useFormError";
import type { ContractRow } from "./outsourcedModel";

/**
 * GAP-HR-OUTSOURCED-01: the register table plus "Add contract" and "Terminate".
 * Both writes are queued (202): on success we say "submitted" and refresh rather
 * than claiming the change has already landed. The backend enforces the HR role
 * gate, validation and the audit trail; canManage only decides which buttons show.
 */
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, minHeight: 44,
  border: "1px solid var(--line, #cbd5e1)", borderRadius: 10, background: "var(--panel, #fff)", color: "var(--ink, #0f172a)",
};

export function OutsourcedRegister({
  rows, canManage, emptyTitle, emptyMessage, cardTitle,
}: { rows: ContractRow[]; canManage: boolean; emptyTitle: string; emptyMessage: string; cardTitle: string }) {
  const t = useTranslations("outsourcedRegister");
  const router = useRouter();
  const formError = useFormError("outsourced contract");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [terminateTarget, setTerminateTarget] = useState<ContractRow | null>(null);

  const [vendorName, setVendorName] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [contractRef, setContractRef] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [valueRupees, setValueRupees] = useState("");

  function resetForm() {
    setVendorName(""); setServiceCategory(""); setContractRef(""); setHeadcount("");
    setContractStart(""); setContractEnd(""); setValueRupees(""); setError(undefined);
  }

  async function submitNew() {
    const paise = valueRupees.trim() === "" ? "0" : parseRupeesToPaise(valueRupees, { allowZero: true });
    if (paise === null) { setError(t("errValue")); return; }
    if (!vendorName.trim() || !serviceCategory.trim()) { setError(t("errRequired")); return; }
    if (!/^\d+$/.test(headcount)) { setError(t("errHeadcount")); return; }
    if (!contractStart || !contractEnd || contractEnd < contractStart) { setError(t("errDates")); return; }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/hrms/outsourced", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendorName: vendorName.trim(), serviceCategory: serviceCategory.trim(),
          ...(contractRef.trim() ? { contractRef: contractRef.trim() } : {}),
          headcount: Number(headcount), contractStart, contractEnd, contractValueMinor: paise,
        }),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, "save")).message); return; }
      setAdding(false);
      resetForm();
      setNotice(t("noticeSubmitted"));
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  async function terminate(row: ContractRow, reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/outsourced/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "terminated", ...(reason ? { remarks: reason } : {}) }),
      });
      if (!res.ok) { setError((await formError.fromResponse(res, "save")).message); return; }
      setTerminateTarget(null);
      setNotice(t("noticeSubmitted"));
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const columns: { key: keyof ContractRow & string; label: string; align?: "left" | "right" | "center"; sortable?: boolean; render?: (r: ContractRow) => React.ReactNode }[] = [
    { key: "vendorName", label: t("colVendor") },
    { key: "serviceCategory", label: t("colService") },
    { key: "contractRef", label: t("colRef") },
    { key: "headcount", label: t("colHeadcount"), align: "right" },
    { key: "period", label: t("colPeriod") },
    { key: "contractValue", label: t("colValue"), align: "right" },
    { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} /> },
    ...(canManage
      ? [{
          key: "id" as const, label: t("colActions"), sortable: false,
          render: (r: ContractRow) => (r.canTerminate
            ? <Button variant="ghost" size="sm" onClick={() => { setError(undefined); setTerminateTarget(r); }}>{t("terminate")}</Button>
            : <span aria-hidden="true">—</span>),
        }]
      : []),
  ];

  return (
    <>
      {notice && <p role="status" aria-live="polite" className="pill good" style={{ margin: "0 0 12px" }}>{notice}</p>}
      <Card
        title={cardTitle}
        link={canManage ? <Button size="sm" onClick={() => { resetForm(); setAdding(true); }}>{t("addContract")}</Button> : undefined}
      >
        <DataTable<ContractRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏢"
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
        />
      </Card>

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        busy={busy}
        title={t("addTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={() => void submitNew()} disabled={busy}>{t("save")}</Button>
          </>
        }
      >
        {error && <p role="alert" className="pill bad" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fVendor")}
            <input style={inputStyle} value={vendorName} maxLength={200} onChange={(e) => setVendorName(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fService")}
            <input style={inputStyle} value={serviceCategory} maxLength={120} onChange={(e) => setServiceCategory(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fRef")}
            <input style={inputStyle} value={contractRef} maxLength={64} onChange={(e) => setContractRef(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fHeadcount")}
            <input style={inputStyle} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fStart")}
            <input style={inputStyle} type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fEnd")}
            <input style={inputStyle} type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>{t("fValue")}
            <input style={inputStyle} inputMode="decimal" value={valueRupees} onChange={(e) => setValueRupees(e.target.value)} /></label>
        </div>
      </Drawer>

      <ConfirmDialog
        open={terminateTarget !== null}
        title={t("terminateTitle")}
        danger
        requireReason
        reasonLabel={t("terminateReason")}
        confirmLabel={t("terminate")}
        busy={busy}
        errorMessage={error}
        description={terminateTarget ? t("terminateDescription", { vendor: terminateTarget.vendorName }) : ""}
        onConfirm={(reason) => terminateTarget && void terminate(terminateTarget, reason)}
        onCancel={() => !busy && setTerminateTarget(null)}
      />
    </>
  );
}
