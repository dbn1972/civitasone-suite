"use client";

/**
 * Marketplace review control. POST /v1/plugins/marketplace/:id/review only queues the
 * review (202); the plugin-service consumer records it afterwards. So this control never
 * says "saved" on the 202: it shows "submitted, not saved yet", polls
 * GET .../review until the stored review carries the reviewId the POST returned, and only
 * then says it is recorded. After MAX polls without a match it says it is still pending.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { ActionButton } from "../../_components/ds";

const REVIEW_POLL_MS = 3000;
const REVIEW_MAX_POLLS = 20;
const RATINGS = [5, 4, 3, 2, 1] as const;

export function MarketplaceReviewButton({
  listingId,
  name,
  canManage = true,
}: {
  listingId?: string;
  name: string;
  canManage?: boolean;
}) {
  const t = useTranslations("pluginMarketplaceReview");
  const [rating, setRating] = useState("");
  // "idle" -> (202) "submitted" -> (poll sees our reviewId) "recorded" | (cap reached) "pending".
  const [phase, setPhase] = useState<"idle" | "submitted" | "recorded" | "pending">("idle");
  const [reviewId, setReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "submitted" || !listingId || !reviewId) return;
    let polls = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      polls += 1;
      try {
        const res = await fetch(`/api/proxy/v1/plugins/marketplace/${listingId}/review`, { credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { data?: { reviewId?: string } | null };
          if (!cancelled && body.data?.reviewId === reviewId) {
            clearInterval(timer);
            setPhase("recorded");
            return;
          }
        }
      } catch {
        /* transient: keep polling until the cap */
      }
      if (!cancelled && polls >= REVIEW_MAX_POLLS) {
        clearInterval(timer);
        setPhase("pending");
      }
    }, REVIEW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, listingId, reviewId]);

  if (!canManage || !listingId) return null;
  if (phase === "submitted") return <span className="muted" role="status">{t("submitted")}. {t("submittedNote")}</span>;
  if (phase === "pending") return <span className="muted" role="status">{t("submitted")}. {t("stillPending")}</span>;
  if (phase === "recorded") return <span className="muted" role="status">{t("recorded")}</span>;

  async function submit(comment?: string): Promise<void> {
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(t("ratingRequired"));
    const text = (comment ?? "").trim();
    const res = await fetch(`/api/proxy/v1/plugins/marketplace/${listingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: value, ...(text ? { comment: text } : {}) }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    const body = (await res.json().catch(() => ({}))) as { data?: { reviewId?: string } };
    setReviewId(body.data?.reviewId ?? null);
    // Without a reviewId we cannot confirm anything, so never claim it was recorded.
    setPhase(body.data?.reviewId ? "submitted" : "pending");
  }

  return (
    <ActionButton
      label={t("review")}
      className="btn"
      confirmTitle={t("confirmTitle", { name })}
      confirmDescription={
        <div>
          <p>{t("confirmDescription")}</p>
          <label>
            {t("ratingLabel")}
            <select value={rating} onChange={(e) => setRating(e.target.value)} style={{ marginInlineStart: 8 }}>
              <option value="">{t("ratingPlaceholder")}</option>
              {RATINGS.map((r) => (
                <option key={r} value={String(r)}>{t("ratingOption", { count: r })}</option>
              ))}
            </select>
          </label>
        </div>
      }
      confirmLabel={t("confirmLabel")}
      optionalReason
      maxReasonLength={1000}
      reasonLabel={t("commentLabel")}
      onConfirm={(comment) => submit(comment)}
    />
  );
}
