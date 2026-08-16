"use client";

/**
 * /crm/voice-of-customer/feedback
 *
 * Citizen feedback form — GIGW 3.0 Part B operational requirement.
 * Collects a 1-5 star service rating, free-text comment, contact type,
 * and a mandatory DPDP Act 2023 consent checkbox before posting to
 * /api/citizen/feedback.
 */
import { useState } from "react";
import { PageHeader } from "../../../../_components/ds";

const FIELD: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 14,
  color: "var(--ink)",
};

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;

  return (
    <div role="radiogroup" aria-label="Service rating" style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n !== 1 ? "s" : ""}`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          style={{
            fontSize: 28,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: n <= active ? "#f59e0b" : "var(--line)",
            transition: "color 0.1s",
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const RATING_LABELS = ["Poor", "Fair", "Good", "Very Good", "Excellent"];

export default function CitizenFeedbackPage() {
  const [rating, setRating] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (rating === 0) {
      setError("Please select a star rating before submitting.");
      return;
    }
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      rating,
      comment: (fd.get("comment") as string)?.trim() || undefined,
      contactType: fd.get("contactType"),
      dpdpConsent: fd.get("dpdpConsent") === "on",
    };

    try {
      const res = await fetch("/api/citizen/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { message?: string }).message ?? `HTTP ${res.status}`
        );
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <>
        <PageHeader
          title="Feedback Submitted"
          back="/crm/voice-of-customer"
          backLabel="Voice of Citizen"
        />
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r)",
            padding: "32px 28px",
            maxWidth: 560,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>🙏</div>
          <h2 style={{ margin: "0 0 8px", color: "var(--ink)", fontSize: 20 }}>
            Thank you for your feedback
          </h2>
          <p style={{ color: "var(--ink-dim)", fontSize: 14, margin: "0 0 20px" }}>
            Your response has been recorded. It helps us improve public services.
          </p>
          <a href="/crm/voice-of-customer" className="btn primary">
            Back to Voice of Citizen
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Citizen Feedback"
        subtitle="Rate the service and share your experience. Your response is confidential."
        back="/crm/voice-of-customer"
        backLabel="Voice of Citizen"
      />
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 560,
        }}
      >
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "color-mix(in srgb, var(--bad) 10%, transparent)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--r)",
              color: "var(--bad)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 20 }}
        >
          {/* Star rating */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
              Service Rating{" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                *
              </span>
            </span>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && (
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {RATING_LABELS[rating - 1]}
              </span>
            )}
          </div>

          {/* Comment */}
          <label style={LABEL}>
            <span style={{ fontWeight: 500 }}>Comments / Suggestions</span>
            <textarea
              name="comment"
              rows={4}
              maxLength={2000}
              placeholder="Tell us about your experience with this service..."
              style={{ ...FIELD, resize: "vertical" }}
            />
          </label>

          {/* Contact type */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
              Submission Type{" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                *
              </span>
            </span>
            <div style={{ display: "flex", gap: 16 }}>
              {[
                { value: "anonymous", label: "Anonymous" },
                { value: "registered", label: "Registered Citizen" },
              ].map(({ value, label }) => (
                <label
                  key={value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    cursor: "pointer",
                    color: "var(--ink)",
                  }}
                >
                  <input
                    type="radio"
                    name="contactType"
                    value={value}
                    required
                    defaultChecked={value === "anonymous"}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* DPDP consent */}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              color: "var(--ink-dim)",
              cursor: "pointer",
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              name="dpdpConsent"
              required
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span>
              I consent to the collection and processing of my feedback data in
              accordance with the{" "}
              <strong>Digital Personal Data Protection Act, 2023 (DPDP Act)</strong>.
              This data will be used solely to improve public service delivery and
              will not be shared with third parties without further consent.{" "}
              <span
                aria-hidden="true"
                style={{ color: "var(--bad)", fontWeight: 600 }}
              >
                *
              </span>
            </span>
          </label>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <a href="/crm/voice-of-customer" className="btn">
              Cancel
            </a>
            <button
              type="submit"
              className="btn primary"
              disabled={saving}
            >
              {saving ? "Submitting..." : "Submit Feedback"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
