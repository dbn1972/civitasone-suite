"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../_components/ds";
import { TOUR_STORAGE_KEY } from "../dashboard/FirstRunTour";

/**
 * Clears the "seen" flag for the dashboard first-run tour and sends the clerk to
 * the dashboard with a client navigation, where the tour mounts fresh and plays
 * again. Lets anyone re-watch the 30-second walkthrough whenever they like.
 *
 * GAP-HELP-HOME-04:
 *  - Uses router.push (no full reload); FirstRunTour reads storage on mount so
 *    a soft navigation is enough to replay it.
 *  - If the browser is blocking saved settings the removeItem throws: we show an
 *    inline alert and do NOT navigate, because the tour would not replay and
 *    silently landing on the dashboard would tell the user nothing.
 *  - Imports TOUR_STORAGE_KEY from FirstRunTour instead of duplicating the
 *    literal, so the two can never drift.
 */
export function ReplayTourButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState(false);

  function replay() {
    try {
      localStorage.removeItem(TOUR_STORAGE_KEY);
    } catch {
      setError(true);
      return;
    }
    setError(false);
    toast.success("Welcome tour will start on the dashboard.");
    router.push("/dashboard");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button type="button" className="btn ghost" onClick={replay}>
        ▶ Take the welcome tour again
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--bad)", fontSize: 12.5 }}>
          Your browser is blocking saved settings, so the tour cannot replay.
        </span>
      )}
    </div>
  );
}
