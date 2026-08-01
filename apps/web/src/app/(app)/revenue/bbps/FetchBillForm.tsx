"use client";

import { useId, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { data?: { messageId?: string } };

export function FetchBillForm() {
  const [assesseeIdentifier, setAssesseeIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const inputId = useId();
  const summaryId = useId();
  const inputErrorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: Record<string, string> = {};
    const trimmed = assesseeIdentifier.trim();
    if (!trimmed) errors.assesseeIdentifier = "Enter the assessee identifier (property/water connection number).";
    setFieldErrors(errors);

    if (errors.assesseeIdentifier) {
      setTone("bad");
      setMessage("Please correct the highlighted field.");
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/bbps/fetch-bill", {
        method: "POST",
        body: JSON.stringify({ assesseeIdentifier: trimmed }),
      });
      setTone("good");
      setMessage(
        res.data?.messageId
          ? `Bill fetch request submitted (message ID ${res.data.messageId}). It is processed asynchronously — this screen does not show the fetched bill.`
          : "Bill fetch request submitted.",
      );
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginBottom: 16 }} aria-label="Fetch BBPS bill">
      <Card title="Fetch Bill" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
            <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee Identifier{" "}
              <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                *
              </span>
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={assesseeIdentifier}
              onChange={(e) => setAssesseeIdentifier(e.target.value)}
              maxLength={100}
              aria-required="true"
              aria-invalid={!!fieldErrors.assesseeIdentifier || undefined}
              aria-describedby={fieldErrors.assesseeIdentifier ? inputErrorId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            {fieldErrors.assesseeIdentifier && (
              <p id={inputErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors.assesseeIdentifier}
              </p>
            )}
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy} aria-busy={busy}>
              {busy ? "Submitting…" : "Fetch Bill"}
            </button>
          </div>

          {message && (
            <p
              id={summaryId}
              role={tone === "bad" ? "alert" : "status"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}
