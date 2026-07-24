"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type Citation = { docId: string; title: string; source: string };
type AskAnswer = { interactionId: string; answer: string; citations: Citation[]; answered: boolean; grounded: boolean };

/**
 * Grounded assistant UI: ask → answer with citations → escalate to a helpdesk
 * ticket when unresolved. All calls go through the auth-cookie proxy.
 */
export function AssistantClient() {
  const router = useRouter();
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState("");
  const [escalated, setEscalated] = useState(false);

  async function ask(): Promise<void> {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setEscalated(false);
    setAnswer(null);
    try {
      const res = await fetch("/api/proxy/v1/knowledge/assistant/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error((await res.text()) || "The assistant is unavailable.");
      const body = (await res.json()) as { data: AskAnswer };
      setAnswer(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function escalate(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/knowledge/assistant/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, interactionId: answer?.interactionId, priority: "Medium" }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not open a ticket.");
      setEscalated(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Ask a question</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2, #475569)" }}>
          Your question
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id={inputId}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
            placeholder="e.g. How do I apply for annual leave?"
            style={{ flex: "1 1 320px", minWidth: 240, borderRadius: 8, border: "1px solid var(--line, #e2e8f0)", padding: "10px 12px", fontSize: 14, minHeight: 44 }}
          />
          <button
            type="button"
            onClick={() => void ask()}
            disabled={busy || !question.trim()}
            className="btn btn-primary"
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 8 }}
          >
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>

        {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 14, margin: 0 }}>{error}</p>}

        {answer && (
          <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 16, background: "var(--surface2, #f8fafc)" }}>
            {answer.answered ? (
              <>
                <p style={{ margin: "0 0 12px", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink, #0f172a)" }}>{answer.answer}</p>
                {answer.citations.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--ink3, #94a3b8)", marginBottom: 6 }}>Sources</div>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {answer.citations.map((c) => (
                        <li key={`${c.source}:${c.docId}`} style={{ fontSize: 13, padding: "2px 0" }}>
                          <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--brand, #4f46e5)", marginRight: 6 }}>{c.source}</span>
                          {c.title} <span style={{ fontFamily: "monospace", color: "var(--ink3, #94a3b8)" }}>({c.docId.slice(0, 8)})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p style={{ margin: 0, color: "var(--ink2, #475569)" }}>
                I couldn’t find an answer in the knowledge base. You can escalate this to a support ticket.
              </p>
            )}
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => void escalate()}
                disabled={busy || escalated}
                className="btn"
                style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, border: "1px solid var(--line, #e2e8f0)" }}
              >
                {escalated ? "Ticket opened" : "Escalate to support ticket"}
              </button>
              {escalated && <span style={{ color: "var(--ok, #059669)", fontSize: 14, fontWeight: 600 }}>A helpdesk ticket has been opened.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
