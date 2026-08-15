"use client";

import { useId, useState } from "react";
import { browserFetch } from "@/lib/api/browserClient";

type RunOption = { id: string; payPeriod: string; netAmount: number };
type Format = "csv" | "nach" | "apbs";

export type DscConfig = {
  subjectCn: string;
  notAfter: string;
  sha256Fingerprint: string;
} | null;

const STEPS = ["Select Period", "Preview File", "DSC Signing", "Download"] as const;

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const FORMAT_LABELS: Record<Format, { label: string; desc: string }> = {
  csv: { label: "NEFT / RTGS (CSV)", desc: "Standard bank NEFT/RTGS credit file" },
  nach: { label: "NACH Debit (Text)", desc: "NPCI 120-char mandate file" },
  apbs: { label: "APBS (Text)", desc: "Aadhaar Payment Bridge direct credit file" },
};

function StepBar({ step }: { step: number }) {
  return (
    <nav aria-label="Bank file wizard steps" style={{ display: "flex", marginBottom: 28 }}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--good, #27ae60)" : active ? "var(--accent, #2563eb)" : "var(--line2)",
                  color: done || active ? "#fff" : "var(--ink2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, marginTop: 4, color: active ? "var(--accent, #2563eb)" : "var(--ink2)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "var(--good, #27ae60)" : "var(--line2)", margin: "0 6px", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function BankFileWizard({ runs, dscConfig }: { runs: RunOption[]; dscConfig: DscConfig }) {
  const [step, setStep] = useState(0);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("nach");
  const [filename, setFilename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const runSelectId = useId();
  const selectedRun = runs.find((r) => r.id === runId);

  async function downloadFile() {
    if (!runId) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/runs/${runId}/bank-file?format=${format}`, { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
        setError(body?.error?.message ?? body?.error?.code ?? `Bank file generation failed (${res.status}).`);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const fn = match?.[1] ?? `bank_transfer_${runId}.${format === "csv" ? "csv" : "txt"}`;
      setFilename(fn);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fn;
      a.click();
      URL.revokeObjectURL(url);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏦</p>
        <p style={{ fontWeight: 600 }}>No runs ready for a bank file</p>
        <p style={{ fontSize: 13 }}>A bank transfer file can only be generated for a completed or paid run.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      <StepBar step={step} />

      {/* Step 0 — Select pay period */}
      {step === 0 && (
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <label htmlFor={runSelectId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
              Payroll Run <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <select id={runSelectId} className="input" value={runId} onChange={(e) => setRunId(e.target.value)} style={{ maxWidth: 380 }}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{r.payPeriod} — {inrFmt.format(r.netAmount)}</option>
              ))}
            </select>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Bank File Format</p>
            <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              {(Object.entries(FORMAT_LABELS) as [Format, { label: string; desc: string }][]).map(([f, meta]) => (
                <label
                  key={f}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    padding: "10px 14px", borderRadius: 8,
                    border: `2px solid ${format === f ? "var(--accent, #2563eb)" : "var(--line2)"}`,
                    background: format === f ? "var(--infobg)" : "transparent",
                  }}
                >
                  <input type="radio" name="wiz-format" value={f} checked={format === f} onChange={() => setFormat(f)} style={{ accentColor: "var(--accent)" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</div>
                    <div style={{ fontSize: 12, color: "var(--ink2)" }}>{meta.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <button type="button" className="btn" disabled={!runId} onClick={() => setStep(1)}>
              Next: Preview →
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — Preview */}
      {step === 1 && selectedRun && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "18px 20px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>File Preview</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  ["Pay Period", selectedRun.payPeriod],
                  ["Format", FORMAT_LABELS[format].label],
                  ["Net Amount", inrFmt.format(selectedRun.netAmount)],
                  ["Run ID", selectedRun.id],
                  ["Record Count", "—"],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
                    <td style={{ padding: "8px 0", color: "var(--ink2)", width: "40%" }}>{k}</td>
                    <td style={{ padding: "8px 0", fontWeight: 600 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--line2)", borderRadius: 6, fontFamily: "monospace", fontSize: 12, color: "var(--ink2)" }}>
              [Sample — header row]<br />
              EMP001 | {selectedRun.payPeriod} | CREDIT | {inrFmt.format(selectedRun.netAmount)} | SALARY
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(0)}>← Back</button>
            <button type="button" className="btn" onClick={() => setStep(2)}>Next: DSC →</button>
          </div>
        </div>
      )}

      {/* Step 2 — DSC signing */}
      {step === 2 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Digital Signature Certificate</h3>
            {dscConfig ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 20 }}>✅</span>
                  <span style={{ fontWeight: 600, color: "var(--good, #27ae60)" }}>DSC Active — ready to sign</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[
                      ["Subject CN", dscConfig.subjectCn],
                      ["Valid Until", new Date(dscConfig.notAfter).toLocaleDateString("en-IN")],
                      ["SHA-256", dscConfig.sha256Fingerprint.slice(0, 24) + "…"],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: "1px solid var(--line2)" }}>
                        <td style={{ padding: "7px 0", color: "var(--ink2)", width: "40%" }}>{k}</td>
                        <td style={{ padding: "7px 0", fontWeight: 600, wordBreak: "break-all" }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, color: "var(--warn, #f39c12)" }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>No DSC configured</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>
                    You can still download an unsigned file. Configure a DSC below to enable signing.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>← Back</button>
            <button type="button" className="btn" onClick={() => setStep(3)}>Next: Download →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Download / upload to bank */}
      {step === 3 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--panel)", borderRadius: 10, padding: "28px", textAlign: "center" }}>
            {filename ? (
              <>
                <p style={{ fontSize: 36, margin: "0 0 10px" }}>✅</p>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>File Downloaded</p>
                <p style={{ fontSize: 13, fontFamily: "monospace", color: "var(--ink2)" }}>{filename}</p>
                <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 10 }}>
                  Upload this file to your bank portal to initiate the transfer.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 36, margin: "0 0 10px" }}>⬇️</p>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Ready to download bank file</p>
                {error && (
                  <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13, marginBottom: 10 }}>{error}</p>
                )}
                <button type="button" className="btn" onClick={() => void downloadFile()} disabled={busy}>
                  {busy ? "Generating…" : "Download Bank File"}
                </button>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {!filename && <button type="button" className="btn ghost" onClick={() => setStep(2)}>← Back</button>}
            {filename && (
              <button type="button" className="btn ghost" onClick={() => { setStep(0); setFilename(null); setError(undefined); }}>
                Generate another file
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
