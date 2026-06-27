"use client";

/**
 * Clears the "seen" flag for the dashboard first-run tour and sends the clerk to
 * the dashboard, where the tour will play again. Lets anyone re-watch the
 * 30-second walkthrough whenever they like.
 */
export function ReplayTourButton() {
  function replay() {
    try {
      localStorage.removeItem("civitasone.tour.dashboard.v1");
    } catch {
      /* ignore */
    }
    window.location.assign("/dashboard");
  }

  return (
    <button type="button" className="btn ghost" onClick={replay}>
      ▶ Take the welcome tour again
    </button>
  );
}
