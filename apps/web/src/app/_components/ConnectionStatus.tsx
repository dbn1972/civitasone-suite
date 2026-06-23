"use client";

/**
 * Offline-first UX: a small status pill that tells the user when they're working
 * offline and when queued changes are syncing. Reads navigator.onLine and the
 * SW background-sync signal so the UI never silently behaves as if online.
 */
import { useEffect, useState } from "react";

type Status = "online" | "offline" | "syncing";

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("online");

  useEffect(() => {
    const setFromNavigator = () => setStatus(navigator.onLine ? "online" : "offline");
    setFromNavigator();

    const onOnline = () => {
      setStatus("syncing");
      // Clear the transient "syncing" state shortly after reconnect.
      window.setTimeout(() => setStatus(navigator.onLine ? "online" : "offline"), 2500);
    };
    const onOffline = () => setStatus("offline");
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "CIVITASONE_SYNC") {
        setStatus("syncing");
        window.setTimeout(() => setStatus(navigator.onLine ? "online" : "offline"), 2500);
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker?.addEventListener?.("message", onMessage);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker?.removeEventListener?.("message", onMessage);
    };
  }, []);

  if (status === "online") return null;

  const label = status === "offline" ? "Offline — changes will sync when you reconnect" : "Syncing…";
  const dot = status === "offline" ? "#dc2626" : "#d97706";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: status === "offline" ? "#991b1b" : "#92400e",
        background: status === "offline" ? "#fee2e2" : "#fef3c7",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} aria-hidden />
      {label}
    </div>
  );
}
