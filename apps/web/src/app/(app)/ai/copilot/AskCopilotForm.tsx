"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { guardrailViolationMessages } from "./copilot";
import { detectIdentifiers } from "@/lib/pii";

const MAX_PROMPT = 32000;

/**
 * Sends a prompt to the copilot.
 *
 * The endpoint answers 202: the prompt is accepted and the answer is produced by
 * a consumer afterwards. The form says exactly that instead of pretending an
 * answer is ready, and refreshes so the new turn appears in the history as
 * awaiting.
 */
export function AskCopilotForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState("");
  const [error, setError] = useState("");
  const [violations, setViolations] = useState<string[]>([]);
  // GAP-AI-COPILOT-02: client-side PII advisory state.
  const [piiAcked, setPiiAcked] = useState(false);

  const hasPii = detectIdentifiers(prompt);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      setError("Enter a prompt first.");
      return;
    }

    // GAP-AI-COPILOT-02: advisory client pre-check. Require acknowledgement if
    // identifiers are detected; the server guardrail remains authoritative.
    if (hasPii && !piiAcked) {
      setError("Your prompt appears to contain an identity number (Aadhaar, PAN or similar). Remove it, or tick the confirmation below before sending.");
      return;
    }

    setBusy(true);
    setAccepted("");
    setError("");
    setViolations([]);
    try {
      const res = await fetch("/api/proxy/v1/ai/copilot/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        data?: { id?: string };
      };

      if (res.status === 422 && body.code === "GUARDRAIL_BLOCKED") {
        setViolations(guardrailViolationMessages(body));
        setError("This prompt was blocked by your organisation's guardrails and was not sent.");
        return;
      }
      if (res.status === 422) {
        setError("That prompt could not be used. Rephrase it and try again.");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to use the copilot.");
        return;
      }
      if (!res.ok) {
        setError("The copilot could not be reached. Try again shortly.");
        return;
      }

      setAccepted("Prompt accepted. The answer is being generated and will appear in the history below.");
      setPrompt("");
      setPiiAcked(false);
      router.refresh();
    } catch {
      setError("The copilot could not be reached. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-h"><h3>Ask the Copilot</h3></div>
      <div className="pad">
        {/* GAP-AI-COPILOT-05: use DS colour tokens instead of inline hex. */}
        <label htmlFor="copilot-prompt" style={{ display: "block", fontSize: 13, color: "var(--ink2, #475569)", marginBottom: 6 }}>
          Prompt
        </label>
        <textarea
          id="copilot-prompt"
          className="input"
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setPiiAcked(false); }}
          maxLength={MAX_PROMPT}
          rows={4}
          disabled={busy}
          placeholder="Ask about pending approvals, a file's history, or summarise a note…"
          style={{ width: "100%", fontSize: 14 }}
        />
        {/* GAP-AI-COPILOT-02: DPDP helper text, always visible */}
        <p style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 6, marginBottom: 0 }}>
          Prompts are recorded in full with the response and visible to authorised staff. Do not enter Aadhaar, PAN, bank account or PPO numbers.
        </p>

        {/* GAP-AI-COPILOT-02: PII pre-check inline warning */}
        {hasPii ? (
          <div role="alert" aria-live="polite" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 6, background: "var(--warnbg, #fffaeb)", border: "1px solid var(--warnbd, #fedf89)", fontSize: 13, color: "var(--warn, #b54708)" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>This prompt appears to contain an identity number.</p>
            <p style={{ margin: "6px 0 0", fontSize: 12 }}>
              If you proceed, the full text will be stored and visible. Remove sensitive data, or confirm below that none of the detected patterns are real identifiers.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={piiAcked} onChange={(e) => setPiiAcked(e.target.checked)} />
              I confirm this prompt does not contain real identity numbers
            </label>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
            {prompt.length.toLocaleString("en-IN")} / {MAX_PROMPT.toLocaleString("en-IN")} characters
          </span>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Sending…" : "Ask"}
          </button>
        </div>

        {accepted ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good, #047857)", marginTop: 12, marginBottom: 0 }}>
            {accepted}
          </p>
        ) : null}
        {error ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad, #b42318)", marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
        {violations.length > 0 ? (
          <ul style={{ fontSize: 13, color: "var(--bad, #b42318)", marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
            {violations.map((violation) => <li key={violation}>{violation}</li>)}
          </ul>
        ) : null}
      </div>
    </form>
  );
}
