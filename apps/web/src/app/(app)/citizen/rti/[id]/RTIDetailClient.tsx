"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader, EmptyState, StatusPill, ActionButton, Button } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { RtiDetail } from "../../_data/loaders";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** RTI Act 2005 §7 — 30-day statutory clock, colour + TEXT (WCAG 1.4.1). */
function StatutoryClock({ deadline, closed }: { deadline: string; closed: boolean }) {
  const t = useTranslations("citizenRti");
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return <span style={{ color: "var(--muted)" }}>{t("noDeadline")}</span>;
  if (closed) return <span style={{ color: "var(--muted)" }}>{t("disposed")}</span>;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return <strong style={{ color: "#b42318" }}>{t("overdueBreach", { count: Math.abs(days) })}</strong>;
  if (days === 0) return <strong style={{ color: "#b42318" }}>{t("dueToday")}</strong>;
  const color = days <= 5 ? "#b54708" : "#067647";
  return <strong style={{ color }}>{t("daysRemaining", { count: days })}</strong>;
}

export function RTIDetailClient({
  id,
  initialRti = null,
  initialSource = "error",
}: {
  id: string;
  /**
   * PERF-009 tranche 3: initial data fetched server-side by page.tsx via the
   * citizen loader, so the first paint already has real data instead of
   * shipping empty and waiting on a post-hydration client fetch. Optional
   * (defaults preserve the exact pre-existing client-only behavior) so this
   * component still works if ever rendered without a server loader upstream.
   */
  initialRti?: RtiDetail | null;
  /** "api" = trust initialRti (even if null -- that's a real not-found). "error" = the server loader couldn't get an answer; fall back to the original always-fetch-on-mount behavior. */
  initialSource?: "api" | "error";
}) {
  const t = useTranslations("citizenRti");
  const router = useRouter();
  const [rti, setRti] = useState<RtiDetail | null>(initialRti);
  const [loading, setLoading] = useState(initialSource !== "api");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAppeal, setShowAppeal] = useState(false);
  const [appeal, setAppeal] = useState({ appealType: "first", grounds: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
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
      const res = await fetch(`/api/proxy/v1/citizen/rti/${id}`, { cache: "no-store", signal });
      if (res.status === 404) { setRti(null); return; }
      if (!res.ok) throw new Error((await res.text()) || "Failed to load RTI application.");
      setRti((await res.json()) as RtiDetail);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setLoadError(e instanceof Error ? e.message : "Failed to load RTI application.");
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
        <PageHeader title={t("detailTitle")} back="/citizen/rti" backLabel={t("detailBack")} />
        <p role="status" aria-live="polite" className="pad" style={{ color: "var(--muted)" }}>{t("loadingDetail")}</p>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title={t("detailTitle")} back="/citizen/rti" backLabel={t("detailBack")} />
        <div className="card"><div className="pad">
          <p role="alert" aria-live="assertive" style={{ color: "#b42318" }}>{loadError}</p>
          <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => void load()}>{t("tryAgain")}</Button>
        </div></div>
      </>
    );
  }

  if (!rti) {
    return (
      <>
        <PageHeader title={t("detailTitle")} back="/citizen/rti" backLabel={t("detailBack")} />
        <EmptyState icon="📄" title={t("notFoundTitle")} message={t("notFoundMessage")} />
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
        backLabel={t("detailBack")}
        actions={
          <>
            {rti.responses.length === 0 && (
              <ActionButton
                label={t("recordResponse")}
                requireReason
                reasonLabel="Response document URL (https://…)"
                confirmTitle="Record the PIO response?"
                confirmDescription="Provide the URL of the uploaded response document. This disposes the application under §7 and stops the statutory clock."
                confirmLabel={t("recordResponse")}
                onConfirm={respond}
                onSuccess={() => afterMutate("Response submitted.")}
              />
            )}
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setShowAppeal((s) => !s)}>
              {t("fileAppeal")}
            </Button>
          </>
        }
      />

      {notice ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginBottom: 12 }}>{notice}</p> : null}

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>{t("applicationDetailsTitle")}</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">{t("colRtiNoField")}</div><div className="v">{rti.rtiNo}</div></div>
              <div className="fld"><div className="l">{t("statusField")}</div><div className="v"><StatusPill status={rti.statusLabel ?? rti.status} /></div></div>
              <div className="fld"><div className="l">{t("filedField")}</div><div className="v">{formatIndianDate(rti.createdAt)}</div></div>
              <div className="fld"><div className="l">{t("statutoryDeadlineField")}</div><div className="v">{formatIndianDate(rti.deadline)}</div></div>
              <div className="fld"><div className="l">{t("clockField")}</div><div className="v"><StatutoryClock deadline={rti.deadline} closed={closed} /></div></div>
            </div>
            <div className="pad">
              <div style={labelStyle}>{t("infoSoughtField")}</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{rti.description}</p>
            </div>
          </div>

          {showAppeal && (
            <div className="card">
              <form onSubmit={fileAppeal} className="pad" style={{ maxWidth: 560 }}>
                <h4 style={{ marginTop: 0 }}>{t("fileAppealFormTitle")}</h4>
                <label htmlFor="rti-appeal-type" style={labelStyle}>{t("appealTypeLabel")}</label>
                <select id="rti-appeal-type" value={appeal.appealType} onChange={(e) => setAppeal({ ...appeal, appealType: e.target.value })} style={inputStyle}>
                  <option value="first">{t("appealFirst")}</option>
                  <option value="cic">{t("appealCic")}</option>
                </select>
                <label htmlFor="rti-appeal-grounds" style={labelStyle}>{t("appealGroundsLabel")}</label>
                <textarea id="rti-appeal-grounds" required value={appeal.grounds} onChange={(e) => setAppeal({ ...appeal, grounds: e.target.value })} placeholder={t("appealGroundsPlaceholder")} rows={4} style={{ ...inputStyle, minHeight: 100 }} />
                <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? t("submitting") : t("submitAppeal")}</Button>
                <Button type="button" variant="ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowAppeal(false)}>{t("cancel")}</Button>
                {formError ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{formError}</p> : null}
              </form>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>{t("responsesTitle")}</h3></div>
            <div className="pad">
              {rti.responses.length === 0 ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>{t("noResponse")}</p>
              ) : (
                <ul className="tl">
                  {rti.responses.map((r) => (
                    <li key={r.id} className="done">
                      <div className="t"><a href={r.responseUrl} target="_blank" rel="noopener noreferrer">{t("responseDocument")}</a></div>
                      <div className="d">{formatIndianDate(r.respondedAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>{t("appealsTitle")}</h3></div>
            <div className="pad">
              {rti.appeals.length === 0 ? (
                <p style={{ color: "var(--muted)", margin: 0 }}>{t("noAppeals")}</p>
              ) : (
                <ul className="tl">
                  {rti.appeals.map((a) => (
                    <li key={a.id} className="cur">
                      <div className="t">{a.appealType === "cic" ? t("appealCicShort") : t("appealFirstShort")} — {a.status}</div>
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
