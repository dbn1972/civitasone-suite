"use client";

import { useId, useRef, useState } from "react";
import { Button, Card } from "@/app/_components/ds";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { browserJson } from "@/lib/api/browserClient";
import { useBbpsRequestStatus } from "./useBbpsRequestStatus";

type AcceptedResponse = { data?: { messageId?: string } };

export function FetchBillForm() {
  const [assesseeIdentifier, setAssesseeIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [messageId, setMessageId] = useState<string | null>(null);
  const { status, reset: resetStatus } = useBbpsRequestStatus(messageId);

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
      resetStatus();
      setMessageId(null);
      const res = await browserJson<AcceptedResponse>("v1/revenue/bbps/fetch-bill", {
        method: "POST",
        body: JSON.stringify({ assesseeIdentifier: trimmed }),
      });
      setTone("good");
      const id = res.data?.messageId ?? null;
      setMessageId(id);
      setMessage(
        id
          ? "Bill fetch request submitted — tracking its outcome below."
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              {busy ? "Submitting…" : "Fetch Bill"}
            </Button>
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

          {messageId && status && (
            <div aria-live="polite" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>Fetch status:</span>
              <StatusPill status={status.status} />
              {status.status === "pending" && <span style={{ color: "var(--ink2)" }}>Fetching the bill…</span>}
              {status.status === "success" && (
                <span style={{ color: "var(--ink2)" }}>Bill fetched — see the assessee&apos;s Bills &amp; Demands.</span>
              )}
              {status.status === "failed" && (
                <span role="alert" style={{ color: "var(--bad, #c0392b)" }}>
                  {status.failureReason || "The bill could not be fetched."} You can try again.
                </span>
              )}
            </div>
          )}
        </div>
      </Card>
    </form>
  );
}
