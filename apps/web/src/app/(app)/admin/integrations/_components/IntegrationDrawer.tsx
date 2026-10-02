"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ConfirmDialog, Drawer, ErrorState, SkeletonBar, StatusPill, TabPanel, Tabs } from "@/app/_components/ds";
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
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { describeTestFailure } from "./failureText";

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
  // GAP-ADMIN-INTEGRATIONS-02: the detail GET failed, so we do not know the live state;
  // proposing a change now would be blind.
  const [loadFailed, setLoadFailed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // GAP-ADMIN-INTEGRATIONS-03: Approve/Reject only open a confirmation; nothing is sent until confirmed.
  const [decision, setDecision] = useState<null | "approve" | "reject">(null);
  const [decisionError, setDecisionError] = useState<string | undefined>(undefined);
  const isSftp = provider.id === "sftp";
  const [ingestion, setIngestion] = useState<IngestionConfigDraft>(EMPTY_INGESTION_DRAFT);
  const formError = useFormError(provider.label);

  const load = useCallback(async (scope: EnvScope, signal?: AbortSignal) => {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/${provider.id}/${scope}`, { signal });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "load");
        setError(resolved.message);
        setDetail(null);
        setLoadFailed(true);
        return;
      }
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
      // An abort means this drawer unmounted, or (just as real a risk here,
      // since this effect re-fires on every env switch) a newer load for a
      // different environment scope has already superseded this one.
      if (err instanceof Error && err.name === "AbortError") return;
      setError(formError.fromException("load").message);
      setDetail(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
    // formError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // `formError` object literal isn't, so omitting it here is safe and
    // avoids re-creating load (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, [provider]);

  useEffect(() => {
    const controller = new AbortController();
    void load(env, controller.signal);
    return () => controller.abort();
  }, [env, load]);

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
    formError.clear();
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
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setSuccess("Change proposed. A different admin must approve it (maker-checker).");
      setNote("");
      onChanged();
      await load(env);
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true); setError(null); setSuccess(null); setDecisionError(undefined);
    formError.clear();
    try {
      const res = await fetch(`${API}/${provider.id}/${env}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The operator's own reason is what is stored and audited -- never a canned string.
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        // Failures show inside the dialog the operator is looking at.
        setDecisionError(resolved.message);
        return;
      }
      setDecision(null);
      setSuccess(action === "approve" ? "Change approved and applied." : "Change rejected.");
      onChanged();
      await load(env);
    } catch {
      setDecisionError(formError.fromException("save").message);
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
        setTestResult({ ok: false, status: "unconfigured", error: "Not configured. Add connection details above and save before testing.", detail: null });
      } else {
        // body.status/error/detail here are this test endpoint's own
        // purpose-built connectivity-diagnostic envelope (not a generic
        // HTTP error body), so surfacing them is intentional, catalogued
        // product behaviour, not a raw backend-error passthrough.
        setTestResult({ ok: Boolean(body.ok), status: body.status ?? "failed", error: body.error ?? null, detail: body.detail ?? null });
      }
      onChanged();
    } catch {
      setTestResult({ ok: false, status: "failed", error: formError.fromException("load").message, detail: null });
    } finally {
      setTesting(false);
    }
  }

  const d = detail?.data;
  const pending = detail?.pendingChange ?? null;

  const decisionDanger = decision === "reject" || (env === "prod" && Boolean(pending?.secretChanged));
  const decisionSummary = pending
    ? `${provider.label}, ${env} environment${pending.secretChanged ? ", including a new secret" : ""}`
    : provider.label;

  return (
    <>
      <Drawer
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}><span aria-hidden>{provider.icon}</span> {provider.label}</span>}
        onClose={() => { if (decision === null) onClose(); }}
        busy={busy}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
            <Button onClick={save} disabled={loading || loadFailed} loading={busy}>
              {busy ? "Saving…" : "Propose change"}
            </Button>
          </>
        }
      >
        {/* env-scope switcher */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink2)", marginBottom: 6 }}>Environment</div>
          <Tabs tabs={[...ENV_SCOPES]} active={env} onChange={(t) => setEnv(t as EnvScope)} ariaLabel="Environment scope" idPrefix="int-env" />
        </div>
        <TabPanel idPrefix="int-env" active={env}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {loading ? (
      <div aria-busy="true" aria-label="Loading integration settings" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}><SkeletonBar h={16} w="40%" /><SkeletonBar h={36} /><SkeletonBar h={36} /><SkeletonBar h={36} /></div>
    ) : loadFailed ? (
      <ErrorState error={toHumanError("load", { area: provider.label })} onRetry={() => { void load(env); }} />
    ) : (
      <>
        {/* current status */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusBadge status={d?.status ?? "unconfigured"} />
          {d?.hasSecret && d.secretMasked && (
            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>Secret set: {d.secretMasked}</span>
          )}
          {d?.lastTestedAt && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>Tested {new Date(d.lastTestedAt).toLocaleString("en-IN")}</span>
          )}
        </div>
        {d?.lastError && (
          <div className="alert bad" style={{ marginBottom: 0, fontSize: 12.5 }}>
            <div>{describeTestFailure("failed", d.lastError)}</div>
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer" }}>Technical detail</summary>
              <code style={{ wordBreak: "break-word" }}>{d.lastError}</code>
            </details>
          </div>
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
                  autoComplete={f.secret ? "new-password" : "off"}
                  style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, background: "var(--panel)", color: "var(--ink)" }}
                />
                {f.help && <span style={{ fontSize: 11.5, color: "var(--mut)" }}>{f.help}</span>}
                {formError.fieldError(f.key) && (
                  <span role="alert" style={{ fontSize: 11.5, color: "var(--bad, #b42318)" }}>{formError.fieldError(f.key)}</span>
                )}
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
            {formError.fieldError("note") && (
              <span role="alert" style={{ fontSize: 11.5, color: "var(--bad, #b42318)" }}>{formError.fieldError("note")}</span>
            )}
          </div>

          {isSftp && (
            <SftpIngestionConfig draft={ingestion} onChange={setIngestion} />
          )}
        </div>

        {isSftp && <IngestionRunsView provider={provider.id} env={env} />}

        {/* test connection */}
        <div>
          <Button variant="ghost" onClick={runTest} loading={testing}>
            {testing ? "Testing…" : "🔌 Test connection"}
          </Button>
          <div aria-live="polite">
            {testResult && (
              <div className={`alert ${testResult.ok ? "" : "bad"}`} style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, background: testResult.ok ? "var(--goodbg)" : undefined, borderColor: testResult.ok ? "var(--goodbd)" : undefined, color: testResult.ok ? "var(--good)" : undefined }}>
                {testResult.ok ? `✓ Connected${testResult.detail ? ` — ${testResult.detail}` : ""}` : (
                  <>
                    <div>{`✗ ${describeTestFailure(testResult.status, testResult.error)}`}</div>
                    {testResult.error && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer" }}>Technical detail</summary>
                        <code style={{ wordBreak: "break-word" }}>{`${testResult.status}: ${testResult.error}`}</code>
                      </details>
                    )}
                  </>
                )}
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
                Proposed by {pending.proposedByName ?? "another admin"}{pending.createdAt ? ` on ${new Date(pending.createdAt).toLocaleString("en-IN")}` : ""}{pending.note ? ` — "${pending.note}"` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Button size="sm" onClick={() => { setDecisionError(undefined); setDecision("approve"); }} disabled={busy}>Approve</Button>
                <Button variant="danger" size="sm" onClick={() => { setDecisionError(undefined); setDecision("reject"); }} disabled={busy}>Reject</Button>
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
                  <StatusBadge status={h.status} /> {h.createdAt ? new Date(h.createdAt).toLocaleString("en-IN") : ""}
                  {h.proposedByName ? ` — proposed by ${h.proposedByName}` : ""}{h.approvedByName ? `, decided by ${h.approvedByName}` : ""}{h.approvedAt ? ` on ${new Date(h.approvedAt).toLocaleString("en-IN")}` : ""}{h.note ? ` — ${h.note}` : ""}{h.rejectedReason ? ` (${h.rejectedReason})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    )}
          </div>
        </TabPanel>
      </Drawer>

      <ConfirmDialog
        open={decision !== null}
        danger={decisionDanger}
        requireReason={decision === "reject"}
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel="Reason for rejecting this change (recorded in the audit log)"
        title={decision === "reject" ? "Reject this change?" : "Approve and apply this change?"}
        description={
          decision === "reject"
            ? `The proposed change to ${decisionSummary} is discarded. The proposer will see your reason.`
            : (
              <>
                <p style={{ margin: "0 0 8px" }}>Applies the proposed change to {decisionSummary} immediately.</p>
                {env === "prod" && pending?.secretChanged && (
                  <p style={{ margin: 0 }}><strong>This replaces a live production secret.</strong> Make sure the new value has been verified.</p>
                )}
              </>
            )
        }
        confirmLabel={decision === "reject" ? "Reject change" : "Approve and apply"}
        busy={busy}
        errorMessage={decisionError}
        onConfirm={(reason) => {
          if (decision === "reject") { if (reason) void decide("reject", reason); }
          else if (decision === "approve") void decide("approve");
        }}
        onCancel={() => { setDecision(null); setDecisionError(undefined); }}
      />
    </>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { connected: "Connected", unconfigured: "Not configured", failed: "Failed" };
  return <StatusPill status={status} label={label[status]} />;
}
