"use client";

/**
 * /crm/voice-of-customer/feedback
 *
 * Citizen feedback form — GIGW 3.0 Part B operational requirement.
 * Collects a 1-5 star service rating, free-text comment, contact type,
 * and a mandatory DPDP Act 2023 consent checkbox.
 *
 * Submission is intentionally NOT wired up: there is no `/api/citizen/feedback`
 * route anywhere (no Next.js handler, no rewrite, no backend service — checked
 * citizen-service, crm-service, recommendation-service) and this was never a
 * documented stub, so a real citizen was previously hitting a raw, unparseable
 * "HTTP 404". A real backend here is a separate, larger feature (DPDP-compliant
 * citizen feedback ingestion + storage + moderation) — CRM's own VoC sentiment
 * pipeline (crm-service sentiment module) deliberately has no write route; it is
 * populated only by scoring logged CRM interactions, not citizen self-report.
 * Until that backend exists, the form stays visible as a preview of the intended
 * UX (matching the house EmptyState convention used by the sibling, honest
 * /citizen/feedback stub) but submission is disabled with a plain-language notice
 * instead of silently failing.
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

  /**
   * Nothing to submit to yet (see file header). This guards only against the
   * implicit form submission a browser can still trigger from an Enter
   * keypress even with the submit button disabled — it must never attempt the
   * dead endpoint.
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        <div
          role="note"
          aria-label="Feedback submission status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 16,
            padding: "10px 14px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "var(--r)",
            color: "#92400e",
            fontSize: 13,
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span>
            This form previews the intended citizen feedback experience. Submission is not
            connected to a backend yet, so nothing entered below is saved — please do not use
            it to report a real issue.
          </span>
        </div>

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
              disabled
              title="Submission is not yet available — backend wiring is pending."
            >
              Submission unavailable
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
