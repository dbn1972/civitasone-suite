"use client";

/**
 * /crm/voice-of-customer/feedback
 *
 * Citizen feedback form — GIGW 3.0 Part B operational requirement.
 * Collects a 1-5 star service rating, free-text comment, submission type, and
 * an optional "Regarding" service-request reference.
 *
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05: submission is now wired to crm-service's
 * POST /v1/crm/citizen-feedback (tenant-scoped, zod-validated, audited). The
 * rating + optional comment are stored; the comment is PII shown unmasked only
 * to CRM admins. Ratings surface on the Voice-of-Citizen dashboard's separate
 * "Citizen ratings" tile.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, PageHeader } from "../../../../_components/ds";
import { submitCitizenFeedback } from "@/lib/crm/feedback";
import { toHumanError } from "@/lib/messages";

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
  const t = useTranslations("crmCitizenFeedback");
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;
  const stars = [1, 2, 3, 4, 5];

  /**
   * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-04: a radiogroup is a single tab stop
   * with roving tabindex — only one radio is tabbable, and Arrow/Home/End move
   * the selection. Before this, each of the five stars was its own tab stop
   * with no keyboard selection, and selected vs unselected were the same glyph
   * told apart only by colour.
   */
  function focusStar(n: number) {
    const el = document.getElementById(`star-${n}`);
    el?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const current = value || 1;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current >= 5 ? 1 : current + 1;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current <= 1 ? 5 : current - 1;
        break;
      case "Home":
        next = 1;
        break;
      case "End":
        next = 5;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(next);
    focusStar(next);
  }

  // The first star is tabbable until a selection exists; after that only the
  // selected star is (roving tabindex).
  const tabbableStar = value || 1;

  return (
    <div
      role="radiogroup"
      aria-label={t("serviceRating")}
      aria-required="true"
      aria-describedby="rating-required-hint"
      style={{ display: "flex", gap: 6 }}
    >
      {stars.map((n) => {
        const selected = n <= active;
        return (
          <button
            key={n}
            id={`star-${n}`}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t("starLabel", { count: n })}
            tabIndex={n === tabbableStar ? 0 : -1}
            onClick={() => onChange(n)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            style={{
              fontSize: 28,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 2px",
              // `--muted` (#667085, 4.97:1 on white) for the unselected state —
              // the same token ContractorRatingForm.tsx uses.
              color: selected ? "#f59e0b" : "var(--muted)",
              transition: "color 0.1s",
            }}
          >
            {/* Distinct glyph, not colour alone: filled ★ selected, outline ☆
                unselected — visible in forced-colors / greyscale too. */}
            {selected ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

const RATING_LABELS = ["Poor", "Fair", "Good", "Very Good", "Excellent"];

export default function CitizenFeedbackPage() {
  const t = useTranslations("crmCitizenFeedback");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submissionType, setSubmissionType] = useState<"anonymous" | "registered">("anonymous");
  const [serviceRequestId, setServiceRequestId] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // A loose uuid shape check so a malformed "Regarding" ref is caught client-side
  // before the request (the server also validates it).
  const srTrimmed = serviceRequestId.trim();
  const srValid =
    srTrimmed === "" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(srTrimmed);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (rating < 1) {
      setError(t("errorChooseRating"));
      return;
    }
    if (!srValid) {
      setError(t("errorInvalidReference"));
      return;
    }
    setStatus("saving");
    try {
      await submitCitizenFeedback({
        rating,
        comment,
        submissionType,
        ...(srTrimmed ? { serviceRequestId: srTrimmed } : {}),
      });
      setStatus("done");
      setRating(0);
      setComment("");
      setServiceRequestId("");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : toHumanError("save", { area: "feedback" }).what);
    }
  }

  return (
    <>
      <PageHeader
        title="Citizen Feedback"
        subtitle={t("subtitleLive")}
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
        {status === "done" && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 16,
              padding: "10px 14px",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: "var(--r)",
              color: "#047857",
              fontSize: 13,
            }}
          >
            <span aria-hidden="true">✓</span>
            <span>{t("thankYou")}</span>
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 16,
              padding: "10px 14px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "var(--r)",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
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
            <span
              id="rating-required-hint"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {t("ratingRequiredHint")}
            </span>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && (
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
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
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us about your experience with this service..."
              style={{ ...FIELD, resize: "vertical" }}
            />
          </label>

          {/* Optional "Regarding" service request reference */}
          <label style={LABEL}>
            <span style={{ fontWeight: 500 }}>{t("regardingLabel")}</span>
            <input
              type="text"
              name="serviceRequestId"
              value={serviceRequestId}
              onChange={(e) => setServiceRequestId(e.target.value)}
              placeholder={t("regardingPlaceholder")}
              aria-invalid={!srValid}
              style={FIELD}
            />
            {!srValid && (
              <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>
                {t("regardingInvalid")}
              </span>
            )}
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
                    checked={submissionType === value}
                    onChange={() => setSubmissionType(value as "anonymous" | "registered")}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* DPDP notice.
             GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05: submission is now live, so
             this is a genuine processing notice. Any comment is stored and shown
             only to authorised CRM administrators under DPDP Act 2023. */}
          <div
            role="note"
            aria-label={t("noticeAria")}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              color: "var(--mut)",
              lineHeight: 1.5,
            }}
          >
            <span aria-hidden="true">🛡</span>
            <span>
              {t.rich("noticeLive", { strong: (chunks) => <strong>{chunks}</strong> })}
            </span>
          </div>

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
            <Button type="submit" disabled={status === "saving" || rating < 1}>
              {status === "saving" ? t("submitting") : t("submitFeedback")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
