"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatIndianDate, formatIndianDateTime } from "@/lib/formatters";
import { ActionButton, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type ExportFormat = "json" | "csv";

interface VerifyResult {
  id: string;
  verified: boolean;
  contentMatch: boolean;
  signatureMatch: boolean;
  contentSha256?: string | null;
  signatureAlg?: string | null;
  signingKeyId?: string | null;
  signedAt?: string | null;
  reason?: string;
}

interface ExportStatus {
  id: string;
  status: "queued" | "pending" | "processing" | "completed" | "failed";
  format: string;
  ready: boolean;
  download: string | null;
  rowCount: number | null;
  includesPii: boolean;
  retentionUntil: string | null;
  expiresAt: string | null;
  error: string | null;
  contentSha256: string | null;
  signature: string | null;
  signatureAlg: string | null;
  signingKeyId: string | null;
  signedAt: string | null;
}

const TERMINAL = new Set(["completed", "failed"]);
// GAP-AUDIT-EXPORTS-05: resume a running job's polling after a page reload.
const RESUME_KEY = "audit.exports.currentJob";

function isoStart(d: string): string {
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}
function isoEnd(d: string): string {
  return new Date(`${d}T23:59:59.999Z`).toISOString();
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function ExportConsole({ canExportPii = false }: { canExportPii?: boolean } = {}) {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [includePii, setIncludePii] = useState(false);

  const [job, setJob] = useState<ExportStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const formError = useFormError("export");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // GAP-AUDIT-EXPORTS-05: hold the 120s safety-stop timer so it can be cleared.
  // Previously it was a fire-and-forget setTimeout, so starting job B while
  // job A's safety timer was still pending would stop B's polling early.
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
    setPolling(false);
    try {
      window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // sessionStorage unavailable (SSR / privacy mode) — nothing to clean up.
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // GAP-AUDIT-EXPORTS-05: on mount, resume polling for a job that was running
  // when the page was reloaded. Seed a minimal "queued" job so the Current job
  // card reappears immediately; the first poll fills in the real status.
  useEffect(() => {
    let resumeId: string | null = null;
    try {
      resumeId = window.sessionStorage.getItem(RESUME_KEY);
    } catch {
      resumeId = null;
    }
    if (!resumeId) return;
    setJob((j) =>
      j ?? {
        id: resumeId as string,
        status: "queued",
        format,
        ready: false,
        download: null,
        rowCount: null,
        includesPii: false,
        retentionUntil: null,
        expiresAt: null,
        error: null,
        contentSha256: null,
        signature: null,
        signatureAlg: null,
        signingKeyId: null,
        signedAt: null,
      },
    );
    startPolling(resumeId);
    // Mount-only: intentionally runs once. startPolling/format are stable-enough
    // for a one-shot resume and re-running on their change would restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = useCallback((kind: "ok" | "err" | "info", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/proxy/v1/audit/exports/${id}`, { cache: "no-store" });
        // Transient failure — skip this tick and keep polling (see the catch
        // below); no message is ever shown for a single missed poll, so
        // there is nothing to build here, human-safe or otherwise.
        if (!res.ok) return;
        const body = (await res.json()) as { data: ExportStatus };
        setJob(body.data);
        if (TERMINAL.has(body.data.status)) {
          stopPolling();
          if (body.data.status === "completed") flash("ok", "Export generated and signed.");
          else flash("err", body.data.error ?? "Export failed.");
        }
      } catch {
        // transient — keep polling; surfaced if it never terminates
      }
    },
    [flash, stopPolling],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setPolling(true);
      try {
        window.sessionStorage.setItem(RESUME_KEY, id);
      } catch {
        // sessionStorage unavailable — resume-after-reload simply won't work.
      }
      void pollOnce(id);
      pollRef.current = setInterval(() => void pollOnce(id), 2500);
      // safety stop after 2 minutes — kept in a ref so a later job's polling
      // is never stopped by an earlier job's stale timer.
      safetyRef.current = setTimeout(() => stopPolling(), 120_000);
    },
    [pollOnce, stopPolling],
  );

  const generate = useCallback(async (reason?: string) => {
    setVerify(null);
    if (new Date(from) > new Date(to)) {
      throw new UserFacingError("Start date must be on or before end date.");
    }
    // GAP-AUDIT-EXPORTS-01: create is a v1 resource like status/verify/download.
    // The audit-service registers the create handler under BOTH /audit/exports
    // (legacy) and /v1/audit/exports; use the v1 path so this resource lives in
    // one consistent namespace. The 202 envelope is { id, status, correlationId,
    // data?: { id } } (acceptedResponseSchema), so read data.id first.
    const res = await fetch("/api/proxy/v1/audit/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: isoStart(from), to: isoEnd(to), format, includePii, reason }),
    });
    if (!res.ok) {
      const resolved = await formError.fromResponse(res, "save");
      throw UserFacingError.from(resolved);
    }
    const body = (await res.json()) as { id?: string; data?: { id?: string } };
    const jobId = body.data?.id ?? body.id;
    if (!jobId) throw new UserFacingError("Backend did not return an export id.");
    setJob({
      id: jobId,
      status: "queued",
      format,
      ready: false,
      download: null,
      rowCount: null,
      includesPii: includePii,
      retentionUntil: null,
      expiresAt: null,
      error: null,
      contentSha256: null,
      signature: null,
      signatureAlg: null,
      signingKeyId: null,
      signedAt: null,
    });
    flash("info", "Export queued — generating signed artifact…");
    startPolling(jobId);
    // formError.fromResponse is stable (useCallback'd on a fixed `area`
    // string inside useFormError) even though the wrapping `formError`
    // object literal isn't, so omitting it here is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [from, to, format, includePii, flash, startPolling]);

  const runVerify = useCallback(async () => {
    if (!job) return;
    setVerifyBusy(true);
    setVerify(null);
    try {
      const res = await fetch(`/api/proxy/v1/audit/exports/${job.id}/verify`, { cache: "no-store" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        flash("err", resolved.message);
        return;
      }
      const body = (await res.json()) as { data: VerifyResult };
      setVerify(body.data);
      flash(body.data.verified ? "ok" : "err", body.data.verified ? "Integrity verified." : "Integrity check failed.");
    } catch (caught) {
      flash("err", formError.fromException("load", caught).message);
    } finally {
      setVerifyBusy(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [job, flash]);

  return (
    <div className="grid g-main-l">
      <div className="card">
        <div className="card-h"><h3>Build export</h3></div>
        <div className="pad">
          <label className="lbl" htmlFor="exp-from">From date</label>
          <input id="exp-from" type="date" className="inp" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />

          <label className="lbl" htmlFor="exp-to">To date</label>
          <input id="exp-to" type="date" className="inp" value={to} min={from} onChange={(e) => setTo(e.target.value)} />

          <span className="lbl" id="fmt-label">Format</span>
          <div role="radiogroup" aria-labelledby="fmt-label" style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {(["json", "csv"] as const).map((f) => {
              const on = format === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="chip"
                  onClick={() => setFormat(f)}
                  style={on ? { background: "var(--primary-soft)", color: "var(--primary-d)", fontWeight: 600 } : undefined}
                >
                  {f === "json" ? "JSON (signed)" : "CSV"}
                </button>
              );
            })}
          </div>

          <label className="lbl" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: canExportPii ? "pointer" : "not-allowed" }}
            title={canExportPii ? undefined : "Including PII columns requires an audit-admin role."}>
            <input
              type="checkbox"
              checked={includePii}
              disabled={!canExportPii}
              onChange={(e) => setIncludePii(e.target.checked)}
            />
            Include PII columns (IP, user-agent, before/after values)
          </label>
          <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 4 }}>
            {canExportPii
              ? "PII export is recorded with your reason and enforced server-side."
              : "PII export requires an audit-admin role; the option is disabled for your role."}
          </div>

          <ActionButton
            label="Generate export"
            className="btn primary"
            confirmTitle="Generate signed audit export?"
            confirmDescription={
              <>
                A tamper-evident, HMAC-signed {format.toUpperCase()} artifact will be produced for{" "}
                <strong>{formatIndianDate(from)} – {formatIndianDate(to)}</strong>
                {includePii ? " including PII columns" : ""}. It is held under a 7-year WORM retention lock.
              </>
            }
            confirmLabel="Generate"
            requireReason={includePii}
            reasonLabel="Reason for exporting PII columns (required)"
            onConfirm={generate}
          />

          {toast && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                background: toast.kind === "ok" ? "var(--goodbg)" : toast.kind === "err" ? "var(--badbg)" : "var(--infobg)",
                color: toast.kind === "ok" ? "var(--good)" : toast.kind === "err" ? "var(--bad)" : "var(--info)",
                border: `1px solid ${toast.kind === "ok" ? "var(--goodbd)" : toast.kind === "err" ? "var(--badbd)" : "var(--infobd)"}`,
              }}
            >
              {toast.text}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Current job</h3></div>
        <div className="pad">
          {!job ? (
            <p style={{ color: "var(--mut)", fontSize: 14, margin: 0 }}>
              No active export. Configure a window on the left and generate a signed artifact.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="fields">
                <div className="fld"><div className="l">Job</div><div className="v"><span className="mono">{job.id}</span></div></div>
                <div className="fld">
                  <div className="l">Status</div>
                  <div className="v">
                    {job.status === "completed" ? <span className="pill good">Ready</span>
                      : job.status === "failed" ? <span className="pill bad">Failed</span>
                      : <span className="pill warn">{polling ? "Generating…" : job.status}</span>}
                  </div>
                </div>
                <div className="fld"><div className="l">Format</div><div className="v">{job.format.toUpperCase()}</div></div>
                {job.rowCount != null && <div className="fld"><div className="l">Rows</div><div className="v">{job.rowCount.toLocaleString("en-IN")}</div></div>}
                {job.signedAt && <div className="fld"><div className="l">Signed</div><div className="v">{formatIndianDateTime(job.signedAt)}</div></div>}
                {job.signatureAlg && <div className="fld"><div className="l">Algorithm</div><div className="v"><span className="mono">{job.signatureAlg}</span></div></div>}
                {job.contentSha256 && (
                  <div className="fld">
                    <div className="l">SHA-256</div>
                    <div className="v"><span className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{job.contentSha256}</span></div>
                  </div>
                )}
                {job.retentionUntil && <div className="fld"><div className="l">WORM until</div><div className="v">{formatIndianDate(job.retentionUntil)}</div></div>}
              </div>

              {job.error && (
                <div style={{ color: "var(--bad)", fontSize: 13 }}>{job.error}</div>
              )}

              {job.status === "completed" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {job.download ? (
                    <a className="btn ghost sm" href={`/api/proxy/v1/audit/exports/${job.id}/download?token=${encodeURIComponent(job.download)}`} download>
                      <span aria-hidden="true">⬇</span> Download artifact
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--mut)", alignSelf: "center" }}>
                      Download token withheld (not the requester, or PII role required).
                    </span>
                  )}
                  <Button size="sm" onClick={() => void runVerify()} disabled={verifyBusy}>
                    {verifyBusy ? "Verifying…" : "Verify integrity"}
                  </Button>
                </div>
              )}

              {verify && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    borderRadius: 8,
                    padding: 12,
                    border: `1px solid ${verify.verified ? "var(--goodbd)" : "var(--badbd)"}`,
                    background: verify.verified ? "var(--goodbg)" : "var(--badbg)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {verify.verified ? <><span aria-hidden="true">✅</span> Integrity verified</> : <><span aria-hidden="true">⚠</span> Integrity check failed</>}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                    <li>Content hash matches: {verify.contentMatch ? "yes" : "no"}</li>
                    <li>Signature matches: {verify.signatureMatch ? "yes" : "no"}</li>
                    {verify.signingKeyId && <li>Signing key: <span className="mono">{verify.signingKeyId}</span></li>}
                    {verify.reason && <li>{verify.reason}</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
