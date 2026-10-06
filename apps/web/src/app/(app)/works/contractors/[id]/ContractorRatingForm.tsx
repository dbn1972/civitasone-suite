"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/_components/ds/Toast";
import { ConfirmDialog, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

interface ContractorRatingFormProps {
  contractorId: string;
  currentRating: number;
  ratingCount: number;
  canRate: boolean;
  /** ISO timestamp of the most recent rating, for the self-cooldown hint. */
  lastRatedAt?: string | null;
  /** actorId (JWT sub) of the most recent rating's author. */
  lastRatedBy?: string | null;
  /** The current viewer's actorId, to detect "I rated this recently". */
  viewerId?: string | null;
}

const MIN_REASON = 10;
/** Days within which the SAME user re-rating is warned about (UI hint only; backend is authoritative). */
const COOLDOWN_DAYS = 30;

export function ContractorRatingForm({
  contractorId,
  currentRating,
  ratingCount,
  canRate,
  lastRatedAt,
  lastRatedBy,
  viewerId,
}: ContractorRatingFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const formError = useFormError("rating");

  if (!canRate) {
    return (
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        You do not have permission to rate contractors.
      </p>
    );
  }

  const displayRating = hoverRating || selectedRating;

  // GAP-WORKS-CONTRACTORS-DETAIL-04: warn (don't hard-block — the backend is
  // the authority) when THIS user already rated within the cooldown window.
  const recentlyRatedBySelf = (() => {
    if (!lastRatedAt || !lastRatedBy || !viewerId || lastRatedBy !== viewerId) return false;
    const last = new Date(lastRatedAt).getTime();
    if (Number.isNaN(last)) return false;
    const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
    return days < COOLDOWN_DAYS;
  })();

  async function handleConfirm(reason?: string) {
    const comment = (reason ?? "").trim();
    setBusy(true);
    setErrorMessage(undefined);
    formError.clear();
    try {
      const res = await fetch(
        `/api/proxy/v1/works/contractors/${contractorId}/rate`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: selectedRating, comment }),
        }
      );
      if (!res.ok) {
        // Keep the dialog open so the user sees the message (e.g. a 409
        // cooldown rejection) in context and can act on it.
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDialogOpen(false);
      toast.success("Rating submitted.");
      setSelectedRating(0);
      setTimeout(() => router.refresh(), 600);
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const starButtonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 28,
    padding: "2px 4px",
    lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
        Current:{" "}
        {currentRating > 0
          ? `${currentRating.toFixed(1)} / 5 (${ratingCount} reviews)`
          : "Not yet rated"}
      </p>

      {recentlyRatedBySelf && (
        <p
          role="status"
          style={{ margin: 0, fontSize: 13, color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 8 }}
        >
          You rated this contractor within the last {COOLDOWN_DAYS} days. A new rating
          will be recorded in addition to the previous one.
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            style={{
              ...starButtonStyle,
              color:
                star <= displayRating ? "var(--accent)" : "var(--muted)",
            }}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => setSelectedRating(star)}
            aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
          >
            {star <= displayRating ? "★" : "☆"}
          </button>
        ))}
      </div>

      <div>
        <Button
          variant="primary"
          disabled={selectedRating === 0}
          onClick={() => setDialogOpen(true)}
        >
          Submit Rating
        </Button>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        title="Rate Contractor"
        description={`Rate this contractor ${selectedRating}/5 stars? A rating affects tender eligibility, so record the basis for it.`}
        confirmLabel="Submit"
        requireReason
        reasonLabel="Reason / basis for rating"
        minReasonLength={MIN_REASON}
        maxReasonLength={1000}
        busy={busy}
        errorMessage={errorMessage}
        onConfirm={(reason) => {
          void handleConfirm(reason);
        }}
        onCancel={() => {
          setDialogOpen(false);
          setErrorMessage(undefined);
        }}
      />
    </div>
  );
}
