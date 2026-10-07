"use client";

import Link from "next/link";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/app/_components/ds";

type Citation = { docId: string; title: string; source: string };
type AskAnswer = { interactionId: string; answer: string; citations: Citation[]; answered: boolean; grounded: boolean };
type EscalateResponse = { id: string; status: string; correlationId: string };

/**
 * Grounded assistant UI: ask → answer with citations → escalate to a helpdesk
 * ticket when unresolved. All calls go through the auth-cookie proxy.
 *
 * GAP-KNOWLEDGE-ASSISTANT-01: error display already uses userFacingErrorFromResponse
 *   (safe human error). Added role="alert" for screen-reader announcement.
 * GAP-KNOWLEDGE-ASSISTANT-03: ask() now guards on busy; Enter ignores IME composition;
 *   wrapped in <form onSubmit> for native semantics.
 * GAP-KNOWLEDGE-ASSISTANT-04: priority select + ticket reference displayed after escalation.
 * GAP-KNOWLEDGE-ASSISTANT-05: citations for policies link to /knowledge/policies/{id};
 *   ungrounded answer shows a notice.
 */
export function AssistantClient() {
  const router = useRouter();
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState("");
  const [escalated, setEscalated] = useState(false);
  // GAP-KNOWLEDGE-ASSISTANT-04: selectable priority + ticket reference
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [ticketRef, setTicketRef] = useState<string | null>(null);

  async function ask(): Promise<void> {
    // GAP-KNOWLEDGE-ASSISTANT-03: busy guard prevents duplicate submissions
    if (busy || !question.trim()) return;
    setBusy(true);
    setError("");
    setEscalated(false);
    setTicketRef(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/proxy/v1/knowledge/assistant/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "load");
      const body = (await res.json()) as { data: AskAnswer };
      setAnswer(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function escalate(): Promise<void> {
    if (busy || escalated) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/knowledge/assistant/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, interactionId: answer?.interactionId, priority }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      // GAP-KNOWLEDGE-ASSISTANT-04: read ticket reference from response
      try {
        const body = (await res.json()) as EscalateResponse;
        if (body.id) setTicketRef(body.id);
      } catch { /* response may be 202 with no body — acceptable */ }
      setEscalated(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // GAP-KNOWLEDGE-ASSISTANT-03: ignore IME composition + guard busy
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !busy) {
      e.preventDefault();
      void ask();
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Ask a question</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2, #475569)" }}>
          Your question
        </label>
        {/* GAP-KNOWLEDGE-ASSISTANT-03: form wrapper for native submit semantics */}
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id={inputId}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. How do I apply for annual leave?"
            maxLength={1000}
            style={{ flex: "1 1 320px", minWidth: 240, borderRadius: 8, border: "1px solid var(--line, #e2e8f0)", padding: "10px 12px", fontSize: 14, minHeight: 44 }}
          />
          <Button
            type="submit"
            disabled={busy || !question.trim()}
            variant="primary"
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 8 }}
          >
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>

        {/* GAP-KNOWLEDGE-ASSISTANT-01: role="alert" for screen-reader announcement */}
        {error && <p role="alert" style={{ color: "var(--danger, #dc2626)", fontSize: 14, margin: 0 }}>{error}</p>}

        {/* GAP-KNOWLEDGE-ASSISTANT-06: remind staff not to enter personal identifiers */}
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut, #667085)" }}>
          Do not enter personal identifiers (Aadhaar, PAN, phone numbers or email addresses) in your question.
        </p>

        {answer && (
          <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 16, background: "var(--surface2, #f8fafc)" }}>
            {answer.answered ? (
              <>
                {/* GAP-KNOWLEDGE-ASSISTANT-05: ungrounded notice */}
                {!answer.grounded && (
                  <p role="status" style={{ margin: "0 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--warn-bg, #fffbeb)", color: "var(--warn, #92400e)", fontSize: 13 }}>
                    This answer is not grounded in a source document — verify before relying on it.
                  </p>
                )}
                <p style={{ margin: "0 0 12px", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink, #0f172a)" }}>{answer.answer}</p>
                {answer.citations.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--mut)", marginBottom: 6 }}>Sources</div>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {answer.citations.map((c) => (
                        <li key={`${c.source}:${c.docId}`} style={{ fontSize: 13, padding: "2px 0" }}>
                          <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--brand, #4f46e5)", marginRight: 6 }}>{c.source}</span>
                          {/* GAP-KNOWLEDGE-ASSISTANT-05: link policy citations to detail page */}
                          {c.source === "policy" ? (
                            <Link href={`/knowledge/policies/${c.docId}`} title={c.docId}>{c.title}</Link>
                          ) : (
                            <span title={c.docId}>{c.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p style={{ margin: 0, color: "var(--ink2, #475569)" }}>
                I couldn&apos;t find an answer in the knowledge base. You can escalate this to a support ticket.
              </p>
            )}
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* GAP-KNOWLEDGE-ASSISTANT-04: priority select */}
              {!escalated && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)" }}>
                  Priority
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="inp"
                    style={{ minHeight: 36, fontSize: 13, padding: "4px 8px", borderRadius: 6 }}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </label>
              )}
              <Button
                onClick={() => void escalate()}
                disabled={busy || escalated}
                variant="ghost"
                style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, border: "1px solid var(--line, #e2e8f0)" }}
              >
                {escalated ? "Ticket opened" : "Escalate to support ticket"}
              </Button>
              {escalated && (
                <span style={{ color: "var(--ok, #059669)", fontSize: 14, fontWeight: 600 }}>
                  A helpdesk ticket has been opened.{ticketRef ? ` Ref: ${ticketRef.slice(0, 8).toUpperCase()}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
