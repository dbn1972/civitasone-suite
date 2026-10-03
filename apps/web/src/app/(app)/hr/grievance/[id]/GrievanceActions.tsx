"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { GRIEVANCE_DISPOSITIONS } from "../grievanceModel";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 12px", fontSize: 14,
  border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg2)", color: "var(--ink)",
};

/**
 * GAP-HR-GRIEVANCE-02: Assign (HR officer picked via EntityPicker, never a
 * typed id) and Dispose (disposition + mandatory remarks, behind a confirm).
 * Both are async commands (202); the page is refreshed afterwards.
 */
export function GrievanceActions({ id, grievantId }: { id: string; grievantId: string }) {
  const t = useTranslations("grievanceDetail");
  const router = useRouter();
  const formError = useFormError("grievance");
  const uid = useId();
  const [assignee, setAssignee] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState<string | undefined>();
  const idem = useRef<{ assign?: string; dispose?: string }>({});
  const key = (k: "assign" | "dispose") => (idem.current[k] ??= crypto.randomUUID());

  async function call(path: string, body: unknown, which: "assign" | "dispose"): Promise<string | null> {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/grievances/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": key(which) },
        body: JSON.stringify(body),
      });
      if (!res.ok) return (await formError.fromResponse(res, "save")).message;
      return null;
    } catch {
      return formError.fromException("save").message;
    }
  }

  async function assign() {
    if (!assignee) { setError(t("assigneeRequired")); return; }
    if (assignee === grievantId) { setError(t("assigneeIsGrievant")); return; }
    setBusy(true); setError("");
    const err = await call("assign", { assigneeEmployeeId: assignee, ...(note.trim() ? { note: note.trim() } : {}) }, "assign");
    setBusy(false);
    if (err) { setError(err); return; }
    idem.current.assign = undefined;
    setAssignee(null); setNote("");
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error && <p role="alert" className="pill bad" style={{ margin: 0 }}>{error}</p>}
      <section aria-labelledby={`${uid}-assign`} style={{ display: "grid", gap: 8 }}>
        <h3 id={`${uid}-assign`} style={{ fontSize: 14, margin: 0 }}>{t("assignTitle")}</h3>
        <label htmlFor={`${uid}-officer`} style={{ fontSize: 13, fontWeight: 600 }}>{t("assignLabel")}</label>
        <EntityPicker id={`${uid}-officer`} value={assignee} onChange={(v) => setAssignee(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={searchEmployees} resolve={resolveEmployees} placeholder={t("assignPlaceholder")} />
        <label htmlFor={`${uid}-note`} style={{ fontSize: 13, fontWeight: 600 }}>{t("assignNoteLabel")}</label>
        <input id={`${uid}-note`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
        <div><Button type="button" onClick={() => void assign()} disabled={busy}>{t("assignButton")}</Button></div>
      </section>

      <section aria-labelledby={`${uid}-dispose`} style={{ display: "grid", gap: 8 }}>
        <h3 id={`${uid}-dispose`} style={{ fontSize: 14, margin: 0 }}>{t("disposeTitle")}</h3>
        <label htmlFor={`${uid}-disp`} style={{ fontSize: 13, fontWeight: 600 }}>{t("dispositionLabel")}</label>
        <select id={`${uid}-disp`} value={disposition} onChange={(e) => setDisposition(e.target.value)} style={inputStyle}>
          <option value="">{t("dispositionPlaceholder")}</option>
          {GRIEVANCE_DISPOSITIONS.map((d) => <option key={d} value={d}>{t(`disposition_${d}` as never)}</option>)}
        </select>
        <div>
          <Button type="button" variant="ghost" disabled={!disposition || busy}
            onClick={() => { setDialogError(undefined); setConfirmOpen(true); }}>{t("disposeButton")}</Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={t("disposeConfirmTitle")}
        description={t("disposeConfirmDescription")}
        confirmLabel={t("disposeConfirmLabel")}
        danger
        requireReason
        reasonLabel={t("disposeRemarksLabel")}
        minReasonLength={5}
        maxReasonLength={2000}
        busy={busy}
        errorMessage={dialogError}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={async (reason?: string) => {
          setBusy(true); setDialogError(undefined);
          const err = await call("dispose", { disposition, remarks: (reason ?? "").trim() }, "dispose");
          setBusy(false);
          if (err) { setDialogError(err); return; }
          setConfirmOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
