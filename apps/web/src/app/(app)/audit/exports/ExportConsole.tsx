"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatIndianDate } from "@/lib/formatters";
import { ActionButton } from "@/app/_components/ds";

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

export function ExportConsole() {
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const flash = useCallback((kind: "ok" | "err" | "info", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/proxy/v1/audit/exports/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
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
      void pollOnce(id);
      pollRef.current = setInterval(() => void pollOnce(id), 2500);
      // safety stop after 2 minutes
      window.setTimeout(() => stopPolling(), 120_000);
    },
    [pollOnce, stopPolling],
  );

  const generate = useCallback(async () => {
    setVerify(null);
    if (new Date(from) > new Date(to)) {
      throw new Error("Start date must be on or before end date.");
    }
    const res = await fetch("/api/proxy/audit/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: isoStart(from), to: isoEnd(to), format, includePii }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Export request rejected (${res.status}). ${txt.slice(0, 160)}`);
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("Backend did not return an export id.");
    setJob({
      id: body.id,
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
    startPolling(body.id);
  }, [from, to, format, includePii, flash, startPolling]);

  const runVerify = useCallback(async () => {
    if (!job) return;
    setVerifyBusy(true);
    setVerify(null);
    try {
      const res = await fetch(`/api/proxy/v1/audit/exports/${job.id}/verify`, { cache: "no-store" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Verify failed (${res.status}). ${txt.slice(0, 160)}`);
      }
      const body = (await res.json()) as { data: VerifyResult };
      setVerify(body.data);
      flash(body.data.verified ? "ok" : "err", body.data.verified ? "Integrity verified." : "Integrity check failed.");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Verify failed.");
    } finally {
      setVerifyBusy(false);
    }
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

          <label className="lbl" id="fmt-label">Format</label>
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

          <label className="lbl" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={includePii} onChange={(e) => setIncludePii(e.target.checked)} />
            Include PII columns (IP, user-agent, before/after values)
          </label>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 4 }}>
            PII export requires an audit-admin role; honoured server-side.
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
                background: toast.kind === "ok" ? "#ecfdf3" : toast.kind === "err" ? "#fef3f2" : "#eff6ff",
                color: toast.kind === "ok" ? "#067647" : toast.kind === "err" ? "#b42318" : "#175cd3",
                border: `1px solid ${toast.kind === "ok" ? "#abefc6" : toast.kind === "err" ? "#fecdca" : "#b2ddff"}`,
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
            <p style={{ color: "#667085", fontSize: 14, margin: 0 }}>
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
                {job.signedAt && <div className="fld"><div className="l">Signed</div><div className="v">{formatIndianDate(job.signedAt)}</div></div>}
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
                <div style={{ color: "#b42318", fontSize: 13 }}>{job.error}</div>
              )}

              {job.status === "completed" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {job.download ? (
                    <a className="btn ghost sm" href={`/api/proxy/v1/audit/exports/${job.id}/download?token=${encodeURIComponent(job.download)}`} download>
                      ⬇ Download artifact
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: "#667085", alignSelf: "center" }}>
                      Download token withheld (not the requester, or PII role required).
                    </span>
                  )}
                  <button type="button" className="btn primary sm" onClick={() => void runVerify()} disabled={verifyBusy}>
                    {verifyBusy ? "Verifying…" : "Verify integrity"}
                  </button>
                </div>
              )}

              {verify && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    borderRadius: 8,
                    padding: 12,
                    border: `1px solid ${verify.verified ? "#abefc6" : "#fecdca"}`,
                    background: verify.verified ? "#f6fef9" : "#fffbfa",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {verify.verified ? "✅ Integrity verified" : "⚠ Integrity check failed"}
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
