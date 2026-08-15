"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card } from "../../../../_components/ds";

const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 500 };
const FIELD: React.CSSProperties = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--bg)", color: "var(--ink)", fontSize: 14, width: "100%" };

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label="Service rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          aria-pressed={value === n}
          style={{ fontSize: 24, background: "none", border: "none", cursor: "pointer", color: n <= value ? "#f59e0b" : "#d1d5db", padding: 2 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function CitizenFeedbackPage() {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [contactType, setContactType] = useState<"anonymous" | "registered">("anonymous");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) { setError("Please select a star rating."); return; }
    if (contactType === "registered" && !dpdpConsent) { setError("DPDP consent is required when submitting as a registered citizen."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/citizen/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, contactType, dpdpConsent }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <>
        <PageHeader title="Voice of Citizen — Feedback" back="/crm/voice-of-customer" />
        <Card>
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ margin: "0 0 8px" }}>Thank you for your feedback</h2>
            <p style={{ color: "var(--ink2)", margin: "0 0 24px" }}>
              Your response has been recorded and will help improve citizen services.
            </p>
            <a className="btn" href="/crm/voice-of-customer">Back to Voice of Citizen</a>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Voice of Citizen — Feedback" back="/crm/voice-of-customer" />
      <Card title="Citizen Service Feedback">
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, padding: "8px 0" }}>
          <label style={LABEL}>
            Service Rating <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
            <StarRating value={rating} onChange={setRating} />
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>1 = Very Poor, 5 = Excellent</span>
          </label>

          <label style={LABEL}>
            Comment / Feedback
            <textarea
              style={{ ...FIELD, minHeight: 100, resize: "vertical" }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              placeholder="Describe your experience with this service..."
            />
            <span style={{ fontSize: 11, color: "var(--ink2)", textAlign: "right" }}>{comment.length}/1000</span>
          </label>

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "12px 16px" }}>
            <legend style={{ fontSize: 14, fontWeight: 500, padding: "0 4px" }}>Submission Type</legend>
            <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
              {(["anonymous", "registered"] as const).map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" name="contactType" value={t} checked={contactType === t} onChange={() => setContactType(t)} />
                  {t === "anonymous" ? "Anonymous" : "Registered Citizen"}
                </label>
              ))}
            </div>
          </fieldset>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={dpdpConsent}
              onChange={(e) => setDpdpConsent(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span>
              I consent to the processing of my personal data for the purpose of citizen feedback analysis,
              in accordance with the{" "}
              <strong>Digital Personal Data Protection Act (DPDP) 2023</strong>.
              My data will not be shared with third parties without my explicit consent.
            </span>
          </label>

          {error && (
            <p role="alert" style={{ color: "#ef4444", fontSize: 13, margin: 0, padding: "8px 12px", background: "#fef2f2", borderRadius: "var(--r)", border: "1px solid #fecaca" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" className="btn primary" disabled={saving} aria-busy={saving}>
              {saving ? "Submitting…" : "Submit Feedback"}
            </button>
            <button type="button" className="btn" onClick={() => router.push("/crm/voice-of-customer")}>
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
