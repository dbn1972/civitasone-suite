"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/_components/ds/Toast";
import { ConfirmDialog } from "@/app/_components/ds";

interface ContractorRatingFormProps {
  contractorId: string;
  currentRating: number;
  ratingCount: number;
}

export function ContractorRatingForm({
  contractorId,
  currentRating,
  ratingCount,
}: ContractorRatingFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const displayRating = hoverRating || selectedRating;

  async function handleConfirm() {
    setBusy(true);
    setErrorMessage(undefined);
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message ?? `Error ${res.status}`);
      }
      setDialogOpen(false);
      toast.success("Rating submitted.");
      setTimeout(() => router.refresh(), 600);
      setSelectedRating(0);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong."
      );
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
        <button
          type="button"
          disabled={selectedRating === 0}
          onClick={() => setDialogOpen(true)}
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: selectedRating === 0 ? "not-allowed" : "pointer",
            opacity: selectedRating === 0 ? 0.5 : 1,
          }}
        >
          Submit Rating
        </button>
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
