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
}

export function ContractorRatingForm({
  contractorId,
  currentRating,
  ratingCount,
  canRate,
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

  async function handleConfirm() {
    setBusy(true);
    setErrorMessage(undefined);
    formError.clear();
    try {
      const res = await fetch(
        `/api/proxy/v1/works/contractors/${contractorId}/rate`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: selectedRating }),
        }
      );
      if (!res.ok) {
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDialogOpen(false);
      toast.success("Rating submitted.");
      setTimeout(() => router.refresh(), 600);
      setSelectedRating(0);
    } catch {
      setErrorMessage(formError.fromException("save").message);
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
        description={`Rate this contractor ${selectedRating}/5 stars?`}
        confirmLabel="Submit"
        busy={busy}
        errorMessage={errorMessage}
        onConfirm={handleConfirm}
        onCancel={() => {
          setDialogOpen(false);
          setErrorMessage(undefined);
        }}
      />
    </div>
  );
}
