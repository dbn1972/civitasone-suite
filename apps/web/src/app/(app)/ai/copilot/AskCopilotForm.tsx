"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { guardrailViolationMessages } from "./copilot";

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      setError("Enter a prompt first.");
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
        setError(body.message || "That prompt could not be used. Rephrase it and try again.");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to use the copilot.");
        return;
      }
      if (!res.ok) {
        setError(body.message || "The copilot could not be reached. Try again shortly.");
        return;
      }

      setAccepted("Prompt accepted. The answer is being generated and will appear in the history below.");
      setPrompt("");
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
        <label htmlFor="copilot-prompt" style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 6 }}>
          Prompt
        </label>
        <textarea
          id="copilot-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={MAX_PROMPT}
          rows={4}
          disabled={busy}
          placeholder="Ask about pending approvals, a file's history, or summarise a note…"
          style={{ width: "100%", padding: 10, fontSize: 14 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {prompt.length.toLocaleString("en-IN")} / {MAX_PROMPT.toLocaleString("en-IN")} characters
          </span>
          <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
            {busy ? "Sending…" : "Ask"}
          </button>
        </div>

        {accepted ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 12, marginBottom: 0 }}>
            {accepted}
          </p>
        ) : null}
        {error ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
        {violations.length > 0 ? (
          <ul style={{ fontSize: 13, color: "#b42318", marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
            {violations.map((violation) => <li key={violation}>{violation}</li>)}
          </ul>
        ) : null}
      </div>
    </form>
  );
}
