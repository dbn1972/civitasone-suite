"use client";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader, EmptyState, StatusPill, ActionButton, Button } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import type { Grievance } from "../../_data/loaders";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function RequestDetailClient({
  id,
  initialGrievance = null,
  initialSource = "error",
}: {
  id: string;
  /**
   * PERF-009 tranche 2: initial data fetched server-side by page.tsx via the
   * citizen loader, so the first paint already has real data instead of
   * shipping empty and waiting on a post-hydration client fetch. Optional
   * (defaults preserve the exact pre-existing client-only behavior) so this
   * component still works if ever rendered without a server loader upstream.
   */
  initialGrievance?: Grievance | null;
  /** "api" = trust initialGrievance (even if null -- that's a real not-found). "error" = the server loader couldn't get an answer; fall back to the original always-fetch-on-mount behavior. */
  initialSource?: "api" | "error";
}) {
  const t = useTranslations("citizenRequests");
  const router = useRouter();
  const [grievance, setGrievance] = useState<Grievance | null>(initialGrievance);
  const [loading, setLoading] = useState(initialSource !== "api");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAction, setShowAction] = useState(false);
  const [actionForm, setActionForm] = useState({ actionType: "comment", note: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // GAP-CITIZEN-REQUESTS-DETAIL-05: endpoints accept asynchronously (202), so
  // a mutation's effect may not be visible on the immediate re-read. Track a
  // "processing" state and poll a few times until the status actually changes.
  const [pending, setPending] = useState(false);
  // True only across the very first effect run, and only when the server
  // loader already gave us a trustworthy answer -- skips the redundant
  // client-side fetch-on-mount in that case. Any later run (id changed) or a
  // first run where the server loader itself failed behaves exactly as
  // before (unconditional fetch).
  const skipFirstFetch = useRef(initialSource === "api");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}`, { cache: "no-store", signal });
      if (res.status === 404) { setGrievance(null); return; }
      if (!res.ok) throw await userFacingErrorFromResponse(res, "load");
      setGrievance((await res.json()) as Grievance);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setLoadError(e instanceof Error ? e.message : "Failed to load request.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // GAP-CITIZEN-REQUESTS-DETAIL-05: endpoints accept asynchronously (202), so
  // the status may still be the old value on the immediate re-read. Show a
  // "processing" cue and poll (max ~5 tries, 3s apart) until the status
  // actually changes, then clear the pending state.
  const afterMutate = useCallback((msg: string) => {
    const prevStatus = grievance?.status;
    setNotice(msg);
    setPending(true);
    router.refresh();
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Grievance;
          setGrievance(next);
          if (next.status !== prevStatus) { setPending(false); return; }
        }
      } catch {
        /* transient — keep trying up to the cap */
      }
      if (tries >= 5) { setPending(false); return; }
      window.setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
  }, [grievance?.status, id, router]);

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
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
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
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function escalate(reason?: string) {
    // GAP-CITIZEN-REQUESTS-DETAIL-04: never substitute a placeholder reason —
    // the audit trail must carry the real reason the officer typed. The
    // ConfirmDialog's requireReason already blocks an empty submission.
    const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/escalate`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function reopen(reason?: string) {
    // GAP-CITIZEN-REQUESTS-DETAIL-04: no "Reopened" placeholder — send the
    // real reason (dialog-enforced non-empty).
    const res = await fetch(`/api/proxy/v1/citizen/grievances/${id}/reopen`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
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
          <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => void load()}>{t("tryAgain")}</Button>
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
        subtitle={`${requestNo} · ${humanizeStatus(grievance.category)}`}
        back="/citizen/requests"
        backLabel={t("detailBack")}
        actions={
          <>
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setShowAction((s) => !s)}>
              {t("addAction")}
            </Button>
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
              <div className="fld"><div className="l">{t("categoryField")}</div><div className="v">{humanizeStatus(grievance.category)}</div></div>
              <div className="fld"><div className="l">{t("statusField")}</div><div className="v"><StatusPill status={grievance.status} />{pending ? <span role="status" aria-live="polite" style={{ marginLeft: 8 }}><StatusPill status="in progress" label={t("processing")} /></span> : null}</div></div>
              <div className="fld"><div className="l">{t("priorityField")}</div><div className="v">{humanizeStatus(grievance.priority)}</div></div>
              {grievance.departmentRef && <div className="fld"><div className="l">{t("departmentField")}</div><div className="v">{grievance.departmentRef}</div></div>}
              {/* GAP-CITIZEN-REQUESTS-DETAIL-07: show the assigned officer when
                  present; "—" when unassigned. (A raw UUID would be meaningless
                  — only render a value the API gives us as a name/ref.) */}
              <div className="fld"><div className="l">{t("assignedToField")}</div><div className="v">{grievance.assignedTo ?? "—"}</div></div>
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
                <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save action"}</Button>
                <Button type="button" variant="ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowAction(false)}>{t("cancel")}</Button>
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
                      <div className="t">{humanizeStatus(a.actionType)}{a.note ? ` — ${a.note}` : ""}</div>
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
