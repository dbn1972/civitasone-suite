"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, StatusPill, ActionButton } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

/** Shape returned by GET /v1/citizen/rti/:id. */
interface RtiResponse { id: string; responseUrl: string; respondedAt: string; }
interface RtiAppeal { id: string; appealType: string; grounds: string; status: string; createdAt: string; }
interface RtiDetail {
  id: string;
  rtiNo: string;
  subject: string;
  description: string;
  cpioRef: string;
  deadline: string;
  status: string;
  statusLabel: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  responses: RtiResponse[];
  appeals: RtiAppeal[];
}

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** RTI Act 2005 §7 — 30-day statutory clock, colour + TEXT (WCAG 1.4.1). */
function StatutoryClock({ deadline, closed }: { deadline: string; closed: boolean }) {
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return <span style={{ color: "var(--muted)" }}>No deadline on record</span>;
  if (closed) return <span style={{ color: "var(--muted)" }}>Disposed — clock stopped</span>;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return <strong style={{ color: "#b42318" }}>{`Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} (statutory breach)`}</strong>;
  if (days === 0) return <strong style={{ color: "#b42318" }}>Due today</strong>;
  const color = days <= 5 ? "#b54708" : "#067647";
  return <strong style={{ color }}>{`${days} day${days === 1 ? "" : "s"} remaining`}</strong>;
}

export function RTIDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [rti, setRti] = useState<RtiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAppeal, setShowAppeal] = useState(false);
  const [appeal, setAppeal] = useState({ appealType: "first", grounds: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/proxy/v1/citizen/rti/${id}`, { cache: "no-store" });
      if (res.status === 404) { setRti(null); return; }
      if (!res.ok) throw new Error((await res.text()) || "Failed to load RTI application.");
      setRti((await res.json()) as RtiDetail);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load RTI application.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const afterMutate = useCallback((msg: string) => {
    setNotice(msg);
    void load();
    router.refresh();
  }, [load, router]);

  // Officer respond: requires a URL to the uploaded response document.
  async function respond(reason?: string) {
    const responseUrl = (reason ?? "").trim();
    if (!/^https?:\/\//i.test(responseUrl)) {
      throw new Error("Enter a valid response document URL (https://…).");
    }
    const res = await fetch(`/api/proxy/v1/citizen/rti/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseUrl }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Could not record the response.");
  }

  async function fileAppeal(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch(`/api/proxy/v1/citizen/rti/${id}/appeal`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appealType: appeal.appealType, grounds: appeal.grounds }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not file the appeal.");
      setShowAppeal(false);
      setAppeal({ appealType: "first", grounds: "" });
      afterMutate("Appeal submitted. It will appear once processed.");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not file the appeal.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="RTI Application" back="/citizen/rti" backLabel="RTI Applications" />
        <p role="status" aria-live="polite" className="pad" style={{ color: "var(--muted)" }}>Loading RTI application…</p>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="RTI Application" back="/citizen/rti" backLabel="RTI Applications" />
        <div className="card"><div className="pad">
          <p role="alert" aria-live="assertive" style={{ color: "#b42318" }}>{loadError}</p>
          <button className="btn ghost" style={{ minHeight: 44 }} onClick={() => void load()}>Try again</button>
        </div></div>
      </>
    );
  }

  if (!rti) {
    return (
      <>
        <PageHeader title="RTI Application" back="/citizen/rti" backLabel="RTI Applications" />
        <EmptyState icon="📄" title="RTI application not found" message="This application does not exist or you do not have access to it." />
      </>
    );
  }

  const closed = ["replied", "closed", "appeal", "responded", "appealed"].includes(rti.status) || rti.responses.length > 0;

  return (
    <>
      <PageHeader
        title={rti.subject}
        subtitle={`${rti.rtiNo} · RTI Act 2005`}
        back="/citizen/rti"
        backLabel="RTI Applications"
        actions={
          <>
            {rti.responses.length === 0 && (
              <ActionButton
                label="Record response"
                requireReason
                reasonLabel="Response document URL (https://…)"
                confirmTitle="Record the PIO response?"
                confirmDescription="Provide the URL of the uploaded response document. This disposes the application under §7 and stops the statutory clock."
                confirmLabel="Record response"
                onConfirm={respond}
                onSuccess={() => afterMutate("Response submitted.")}
              />
            )}
            <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => setShowAppeal((s) => !s)}>
              File appeal
            </button>
          </>
        }
      />

      {notice ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginBottom: 12 }}>{notice}</p> : null}

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Application Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">RTI No</div><div className="v">{rti.rtiNo}</div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={rti.statusLabel ?? rti.status} /></div></div>
              <div className="fld"><div className="l">Filed</div><div className="v">{formatIndianDate(rti.createdAt)}</div></div>
              <div className="fld"><div className="l">Statutory Deadline</div><div className="v">{formatIndianDate(rti.deadline)}</div></div>
              <div className="fld"><div className="l">30-day Clock</div><div className="v"><StatutoryClock deadline={rti.deadline} closed={closed} /></div></div>
            </div>
            <div className="pad">
              <div style={labelStyle}>Information sought</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{rti.description}</p>
            </div>
          </div>

          {showAppeal && (
            <div className="card">
              <form onSubmit={fileAppeal} className="pad" style={{ maxWidth: 560 }}>
                <h4 style={{ marginTop: 0 }}>File an appeal</h4>
                <label htmlFor="rti-appeal-type" style={labelStyle}>Appeal type</label>
                <select id="rti-appeal-type" value={appeal.appealType} onChange={(e) => setAppeal({ ...appeal, appealType: e.target.value })} style={inputStyle}>
                  <option value="first">First Appeal (§19(1))</option>
                  <option value="cic">CIC / Second Appeal (§19(3))</option>
                </select>
                <label htmlFor="rti-appeal-grounds" style={labelStyle}>Grounds for appeal</label>
                <textarea id="rti-appeal-grounds" required value={appeal.grounds} onChange={(e) => setAppeal({ ...appeal, grounds: e.target.value })} placeholder="State the grounds for this appeal" rows={4} style={{ ...inputStyle, minHeight: 100 }} />
                <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Submitting…" : "Submit appeal"}</button>
                <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowAppeal(false)}>Cancel</button>
                {formError ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{formError}</p> : null}
              </form>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Responses</h3></div>
            <div className="pad">
              {rti.responses.length === 0 ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>No response recorded yet.</p>
              ) : (
                <ul className="tl">
                  {rti.responses.map((r) => (
                    <li key={r.id} className="done">
                      <div className="t"><a href={r.responseUrl} target="_blank" rel="noopener noreferrer">Response document</a></div>
                      <div className="d">{formatIndianDate(r.respondedAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Appeals</h3></div>
            <div className="pad">
              {rti.appeals.length === 0 ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>No appeals filed.</p>
              ) : (
                <ul className="tl">
                  {rti.appeals.map((a) => (
                    <li key={a.id} className="cur">
                      <div className="t">{a.appealType === "cic" ? "CIC / Second appeal" : "First appeal"} — {a.status}</div>
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
