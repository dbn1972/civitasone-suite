"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader, EmptyState, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

/** Shape returned by GET /v1/citizen/grievances/:id (grievance row + actions). */
interface GrievanceAction {
  id: string;
  actionType: string;
  note?: string | null;
  createdAt: string;
}
interface Grievance {
  id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  departmentRef?: string | null;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  actions: GrievanceAction[];
}

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function RequestDetailClient({ id }: { id: string }) {
  const t = useTranslations("citizenRequests");
  const router = useRouter();
  const [grievance, setGrievance] = useState<Grievance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAction, setShowAction] = useState(false);
  const [actionForm, setActionForm] = useState({ actionType: "comment", note: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}`, { cache: "no-store" });
      if (res.status === 404) { setGrievance(null); return; }
      if (!res.ok) throw new Error((await res.text()) || "Failed to load request.");
      setGrievance((await res.json()) as Grievance);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load request.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Endpoints accept asynchronously (202). Surface that honestly.
  const afterMutate = useCallback((msg: string) => {
    setNotice(msg);
    void load();
    router.refresh();
  }, [load, router]);

  async function addAction(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionType: actionForm.actionType, note: actionForm.note || undefined }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not record the action.");
      setShowAction(false);
      setActionForm({ actionType: "comment", note: "" });
      afterMutate("Action submitted. It will appear once processed.");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not record the action.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(reason?: string) {
    const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/resolve`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: reason || undefined }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not resolve the grievance.");
  }

  async function escalate(reason?: string) {
    const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/escalate`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || "Escalated by officer" }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not escalate the grievance.");
  }

  async function reopen(reason?: string) {
    const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/reopen`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || "Reopened" }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not reopen the grievance.");
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t("detailTitle")} back="/citizen/requests" backLabel={t("detailBack")} />
        <p role="status" aria-live="polite" className="pad" style={{ color: "var(--muted)" }}>{t("loadingDetail")}</p>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title={t("detailTitle")} back="/citizen/requests" backLabel={t("detailBack")} />
        <div className="card"><div className="pad">
          <p role="alert" aria-live="assertive" style={{ color: "#b42318" }}>{loadError}</p>
          <button className="btn ghost" style={{ minHeight: 44 }} onClick={() => void load()}>{t("tryAgain")}</button>
        </div></div>
      </>
    );
  }

  if (!grievance) {
    return (
      <>
        <PageHeader title={t("detailTitle")} back="/citizen/requests" backLabel={t("detailBack")} />
        <EmptyState icon="📨" title={t("notFoundTitle")} message={t("notFoundMessage")} />
      </>
    );
  }

  const isResolved = grievance.status === "resolved" || grievance.status === "closed";
  const requestNo = `GR-${grievance.id.slice(0, 8).toUpperCase()}`;

  return (
    <>
      <PageHeader
        title={grievance.subject}
        subtitle={`${requestNo} · ${grievance.category}`}
        back="/citizen/requests"
        backLabel={t("detailBack")}
        actions={
          <>
            <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => setShowAction((s) => !s)}>
              {t("addAction")}
            </button>
            {!isResolved && (
              <ActionButton
                label={t("resolve")}
                requireReason
                reasonLabel="Resolution note"
                confirmTitle="Mark this grievance resolved?"
                confirmDescription="The citizen will be notified. The action is recorded in the audit trail."
                confirmLabel={t("resolve")}
                onConfirm={resolve}
                onSuccess={() => afterMutate("Resolution submitted.")}
              />
            )}
            {!isResolved && (
              <ActionButton
                label={t("escalate")}
                className="btn danger"
                danger
                requireReason
                reasonLabel="Reason for escalation"
                confirmTitle="Escalate this grievance?"
                confirmDescription="This raises the grievance to the next level under the CPGRAMS escalation matrix."
                confirmLabel={t("escalate")}
                onConfirm={escalate}
                onSuccess={() => afterMutate("Escalation submitted.")}
              />
            )}
            {isResolved && (
              <ActionButton
                label={t("reopen")}
                requireReason
                reasonLabel="Reason for reopening"
                confirmTitle="Reopen this grievance?"
                confirmDescription="CPGRAMS allows reopening a resolved grievance within 30 days of resolution."
                confirmLabel={t("reopen")}
                onConfirm={reopen}
                onSuccess={() => afterMutate("Reopen request submitted.")}
              />
            )}
          </>
        }
      />

      {notice ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginBottom: 12 }}>{notice}</p> : null}

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>{t("requestDetailsTitle")}</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">{t("colRequestNoField")}</div><div className="v">{requestNo}</div></div>
              <div className="fld"><div className="l">{t("categoryField")}</div><div className="v">{grievance.category}</div></div>
              <div className="fld"><div className="l">{t("statusField")}</div><div className="v"><StatusPill status={grievance.status} /></div></div>
              <div className="fld"><div className="l">{t("priorityField")}</div><div className="v">{grievance.priority}</div></div>
              {grievance.departmentRef && <div className="fld"><div className="l">{t("departmentField")}</div><div className="v">{grievance.departmentRef}</div></div>}
              <div className="fld"><div className="l">{t("filedField")}</div><div className="v">{formatIndianDate(grievance.createdAt)}</div></div>
              <div className="fld"><div className="l">{t("lastUpdatedField")}</div><div className="v">{formatIndianDate(grievance.updatedAt)}</div></div>
            </div>
            <div className="pad">
              <div style={labelStyle}>{t("descriptionField")}</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{grievance.description}</p>
            </div>
          </div>

          {showAction && (
            <div className="card">
              <form onSubmit={addAction} className="pad" style={{ maxWidth: 520 }}>
                <h4 style={{ marginTop: 0 }}>{t("recordActionTitle")}</h4>
                <label htmlFor="grievance-action-type" style={labelStyle}>{t("actionTypeLabel")}</label>
                <select id="grievance-action-type" value={actionForm.actionType} onChange={(e) => setActionForm({ ...actionForm, actionType: e.target.value })} style={inputStyle}>
                  <option value="comment">{t("actionComment")}</option>
                  <option value="acknowledged">{t("actionAcknowledged")}</option>
                  <option value="forwarded">{t("actionForwarded")}</option>
                  <option value="info_sought">{t("actionInfoSought")}</option>
                </select>
                <label htmlFor="grievance-action-note" style={labelStyle}>{t("noteLabel")}</label>
                <textarea id="grievance-action-note" value={actionForm.note} onChange={(e) => setActionForm({ ...actionForm, note: e.target.value })} placeholder={t("notePlaceholder")} rows={3} style={{ ...inputStyle, minHeight: 88 }} />
                <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save action"}</button>
                <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowAction(false)}>{t("cancel")}</button>
                {formError ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{formError}</p> : null}
              </form>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>{t("actionHistoryTitle")}</h3></div>
            <div className="pad">
              {grievance.actions.length === 0 ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>{t("noActions")}</p>
              ) : (
                <ul className="tl">
                  {grievance.actions.map((a) => (
                    <li key={a.id} className="done">
                      <div className="t">{a.actionType}{a.note ? ` — ${a.note}` : ""}</div>
                      <div className="d">{formatIndianDate(a.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
