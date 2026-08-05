"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ENV_SCOPES,
  type EnvScope,
  type ProviderMeta,
  type IntegrationRow,
  type ChangeRow,
} from "./providers";
import { SftpIngestionConfig } from "./SftpIngestionConfig";
import { IngestionRunsView } from "./IngestionRunsView";
import {
  extractIngestionDraft,
  buildSftpConfigPatch,
  validateIngestionConfig,
  type IngestionConfigDraft,
} from "@/lib/admin/sftpIngestion";

const EMPTY_INGESTION_DRAFT: IngestionConfigDraft = {
  inboundPath: "",
  filePattern: "",
  archivePath: "",
  leadSource: false,
  leadSourceLabel: "",
  mapping: [],
};

const API = "/api/proxy/v1/admin/integrations";

type TestResult = { ok: boolean; status: string; error: string | null; detail: string | null };

type DetailResponse = {
  data: IntegrationRow;
  pendingChange: ChangeRow | null;
  history: ChangeRow[];
};

export function IntegrationDrawer({
  provider,
  initialEnv,
  onClose,
  onChanged,
}: {
  provider: ProviderMeta;
  initialEnv: EnvScope;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [env, setEnv] = useState<EnvScope>(initialEnv);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isSftp = provider.id === "sftp";
  const [ingestion, setIngestion] = useState<IngestionConfigDraft>(EMPTY_INGESTION_DRAFT);

  const load = useCallback(async (scope: EnvScope) => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/${provider.id}/${scope}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const body: DetailResponse = await res.json();
      setDetail(body);
      setEnabled(body.data.enabled ?? true);
      // Prefill non-secret fields from config; secrets are never prefilled.
      const next: Record<string, string> = {};
      for (const f of provider.fields) {
        if (!f.secret) {
          const v = body.data.config?.[f.key];
          next[f.key] = v == null ? "" : String(v);
        } else {
          next[f.key] = "";
        }
      }
      setValues(next);
      // For the sftp connector, hydrate the lead-ingestion draft from config.
      if (provider.id === "sftp") {
        setIngestion(extractIngestionDraft(body.data.config));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => { void load(env); }, [env, load]);

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function buildConfig(): Record<string, unknown> {
    const cfg: Record<string, unknown> = {};
    for (const f of provider.fields) {
      const raw = values[f.key] ?? "";
      if (f.secret) {
        // Write-only: only include a secret the admin actually typed.
        if (raw !== "") cfg[f.key] = raw;
      } else if (raw !== "") {
        cfg[f.key] = f.type === "number" ? Number(raw) : raw;
      }
    }
    // sftp connector also carries the (non-secret) lead-ingestion fields.
    if (isSftp) Object.assign(cfg, buildSftpConfigPatch(ingestion));
    return cfg;
  }

  async function save() {
    // Block save when the lead-ingestion config is invalid (leadSource on but
    // missing label / no Email-or-Mobile mapping).
    if (isSftp) {
      const ingErrors = validateIngestionConfig(ingestion);
      if (Object.keys(ingErrors).length > 0) {
        setError(ingErrors.leadSourceLabel ?? ingErrors.mapping ?? "Fix the lead-ingestion settings before saving.");
        return;
      }
    }
    setBusy(true); setError(null); setSuccess(null);
    try {
      const res = await fetch(`${API}/${provider.id}/${env}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          config: buildConfig(),
          note: note || undefined,
          expectedVersion: detail?.data.version && detail.data.version > 0 ? detail.data.version : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Save failed (${res.status})`);
      setSuccess("Change proposed. A different admin must approve it (maker-checker).");
      setNote("");
      onChanged();
      await load(env);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const res = await fetch(`${API}/${provider.id}/${env}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason: "Rejected from Admin UI" } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `${action} failed (${res.status})`);
      setSuccess(action === "approve" ? "Change approved and applied." : "Change rejected.");
      onChanged();
      await load(env);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true); setTestResult(null); setError(null);
    try {
      const res = await fetch(`${API}/${provider.id}/${env}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setTestResult({ ok: false, status: "unconfigured", error: body.message ?? "Not configured", detail: null });
      } else {
        setTestResult({ ok: Boolean(body.ok), status: body.status ?? "failed", error: body.error ?? null, detail: body.detail ?? null });
      }
      onChanged();
    } catch (err) {
      setTestResult({ ok: false, status: "failed", error: err instanceof Error ? err.message : "Test failed", detail: null });
    } finally {
      setTesting(false);
    }
  }

  const d = detail?.data;
  const pending = detail?.pendingChange ?? null;

  return (
    <div className="cd-overlay" role="dialog" aria-modal="true" aria-labelledby="int-drawer-title" onClick={onClose}>
      <div
        className="card"
        style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-h">
          <h3 id="int-drawer-title" style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span aria-hidden>{provider.icon}</span> {provider.label}
          </h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="pad" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* env-scope switcher */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 6 }}>Environment</div>
            <div className="seg" role="tablist" aria-label="Environment scope">
              {ENV_SCOPES.map((s) => (
                <span key={s} role="tab" aria-selected={s === env} tabIndex={0}
                  className={s === env ? "on" : undefined}
                  onClick={() => setEnv(s)}
                  onKeyDown={(e) => e.key === "Enter" && setEnv(s)}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--ink2)" }}>Loading…</div>
          ) : (
            <>
              {/* current status */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <StatusBadge status={d?.status ?? "unconfigured"} />
                {d?.hasSecret && d.secretMasked && (
                  <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>Secret set: {d.secretMasked}</span>
                )}
                {d?.lastTestedAt && (
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>Tested {new Date(d.lastTestedAt).toLocaleString()}</span>
                )}
              </div>
              {d?.lastError && (
                <div className="alert bad" style={{ marginBottom: 0, fontSize: 12.5 }}>{d.lastError}</div>
              )}

              {/* form */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {provider.fields.map((f) => {
                  const inputId = `int-${provider.id}-${f.key}`;
                  const masked = f.secret && d?.hasSecret;
                  return (
                    <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <label htmlFor={inputId} style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
                        {f.label}{f.required && <span style={{ color: "var(--bad)" }}> *</span>}
                        {f.secret && <span style={{ color: "var(--mut)", fontWeight: 500 }}> (write-only)</span>}
                      </label>
                      <input
                        id={inputId}
                        type={f.secret ? "password" : (f.type === "number" ? "number" : "text")}
                        value={values[f.key] ?? ""}
                        placeholder={masked ? `${d?.secretMasked ?? "••••"} — leave blank to keep` : f.placeholder}
                        onChange={(e) => setField(f.key, e.target.value)}
                        autoComplete="off"
                        style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, background: "var(--panel)", color: "var(--ink)" }}
                      />
                      {f.help && <span style={{ fontSize: 11.5, color: "var(--mut)" }}>{f.help}</span>}
                    </div>
                  );
                })}

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  Enabled
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label htmlFor="int-note" style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>Change note (maker-checker)</label>
                  <input id="int-note" type="text" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Why is this change being made?"
                    style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, background: "var(--panel)", color: "var(--ink)" }} />
                </div>

                {isSftp && (
                  <SftpIngestionConfig draft={ingestion} onChange={setIngestion} />
                )}
              </div>

              {isSftp && <IngestionRunsView provider={provider.id} env={env} />}

              {/* test connection */}
              <div>
                <button className="btn ghost" onClick={runTest} disabled={testing} aria-busy={testing}>
                  {testing ? "Testing…" : "🔌 Test connection"}
                </button>
                <div aria-live="polite">
                  {testResult && (
                    <div className={`alert ${testResult.ok ? "" : "bad"}`} style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, background: testResult.ok ? "var(--goodbg)" : undefined, borderColor: testResult.ok ? "var(--goodbd)" : undefined, color: testResult.ok ? "var(--good)" : undefined }}>
                      {testResult.ok ? `✓ Connected${testResult.detail ? ` — ${testResult.detail}` : ""}` : `✗ ${testResult.status}: ${testResult.error ?? "failed"}`}
                    </div>
                  )}
                </div>
              </div>

              {/* pending maker-checker change */}
              {pending && (
                <div className="card" style={{ boxShadow: "none", background: "var(--warnbg, #fffaeb)" }}>
                  <div className="pad" style={{ padding: 14, fontSize: 12.5 }}>
                    <strong>Pending change awaiting approval</strong>
                    <div style={{ color: "var(--ink2)", marginTop: 4 }}>
                      Proposed by {pending.proposedBy.slice(0, 8)}… {pending.note ? `— "${pending.note}"` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button className="btn primary sm" onClick={() => decide("approve")} disabled={busy}>Approve</button>
                      <button className="btn danger sm" onClick={() => decide("reject")} disabled={busy}>Reject</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 8 }}>
                      A proposer cannot approve their own change (segregation of duties).
                    </div>
                  </div>
                </div>
              )}

              {error && <div className="alert bad" style={{ marginBottom: 0, fontSize: 12.5 }} role="alert">{error}</div>}
              {success && (
                <div className="alert" style={{ marginBottom: 0, fontSize: 12.5, background: "var(--goodbg)", borderColor: "var(--goodbd)", color: "var(--good)" }} role="status">{success}</div>
              )}

              {/* history */}
              {detail && detail.history.length > 0 && (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 650, color: "var(--ink2)" }}>
                    Change history ({detail.history.length})
                  </summary>
                  <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                    {detail.history.map((h) => (
                      <li key={h.id} style={{ fontSize: 12, color: "var(--ink2)", borderLeft: "2px solid var(--line)", paddingLeft: 10 }}>
                        <StatusBadge status={h.status} /> {h.createdAt ? new Date(h.createdAt).toLocaleString() : ""}
                        {h.note ? ` — ${h.note}` : ""}{h.rejectedReason ? ` (${h.rejectedReason})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        {/* footer actions */}
        <div className="card-h" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, justifyContent: "flex-end", gap: 10 }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn primary" onClick={save} disabled={busy || loading} aria-busy={busy}>
            {busy ? "Saving…" : "Propose change"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { connected: "good", unconfigured: "mut", failed: "bad", approved: "good", pending: "warn", rejected: "bad" };
  const label: Record<string, string> = { connected: "Connected", unconfigured: "Not configured", failed: "Failed" };
  return <span className={`pill ${map[status] ?? "info"}`}>{label[status] ?? status}</span>;
}
