"use client";
/**
 * QualifyPanel — LQ-001. On a lead/contact detail, loads the qualification
 * framework(s) for the business line, collects answers to each question, POSTs
 * to /v1/crm/leads/:id/qualify and shows the outcome + score. On a failed
 * framework load we show the saved-info badge and never fabricate an empty
 * framework set as fact (source==="error").
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getFrameworks,
  qualifyLead,
  type QualificationFramework,
  type QualifyOutcome,
  type LqSource,
} from "@/lib/crm/leadQualification";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function QualifyPanel({ leadId, businessLine }: { leadId: string; businessLine?: string }) {
  const [frameworks, setFrameworks] = useState<QualificationFramework[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [selectedId, setSelectedId] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QualifyOutcome | null>(null);
  const headingId = useId();

  useEffect(() => {
    let live = true;
    (async () => {
      setSource("loading");
      const { data, source: s } = await getFrameworks(businessLine);
      if (!live) return;
      const active = data.filter((f) => f.active && f.id);
      setFrameworks(active);
      setSource(s);
      if (active.length > 0 && active[0].id) setSelectedId(active[0].id);
    })();
    return () => { live = false; };
  }, [businessLine]);

  const selected = frameworks.find((f) => f.id === selectedId);

  function answerKey(idx: number, q: { id?: string }): string {
    return q.id ?? `q${idx}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected?.id) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const out = await qualifyLead(leadId, { frameworkId: selected.id, answers });
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not qualify this lead.");
    } finally {
      setBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <div className="card">
        <div className="card-h"><h3>Qualify lead</h3></div>
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px 12px" }}>
          Loading qualification framework…
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Qualify lead</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>

      {frameworks.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No qualification framework"
          message={businessLine ? `No active framework is configured for the "${businessLine}" business line.` : "No active qualification framework is configured."}
        />
      ) : (
        <form onSubmit={submit} className="pad" aria-labelledby={headingId}>
          {frameworks.length > 1 ? (
            <div style={{ marginBottom: 14 }}>
              <label htmlFor={`${headingId}-fw`} style={labelStyle}>Framework</label>
              <select
                id={`${headingId}-fw`}
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setAnswers({}); setResult(null); }}
                style={inputStyle}
              >
                {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 14 }}>
            {selected?.questions.map((q, idx) => {
              const key = answerKey(idx, q);
              const fieldId = `${headingId}-a-${idx}`;
              return (
                <div key={key}>
                  <label htmlFor={fieldId} style={labelStyle}>{q.text}</label>
                  {q.options && q.options.length > 0 ? (
                    <select
                      id={fieldId}
                      value={answers[key] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
                      style={inputStyle}
                    >
                      <option value="">Select…</option>
                      {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      id={fieldId}
                      value={answers[key] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
                      style={inputStyle}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 12 }}>{error}</p> : null}

          {result ? (
            <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginTop: 12, fontSize: 14 }}>
              Outcome: <strong>{result.outcome}</strong> · Score: <strong>{result.score}</strong>
            </div>
          ) : null}

          <button type="submit" className="btn primary" disabled={busy || !selected?.id} style={{ marginTop: 16, minHeight: 44 }}>
            {busy ? "Qualifying…" : "Qualify lead"}
          </button>
        </form>
      )}
    </div>
  );
}
