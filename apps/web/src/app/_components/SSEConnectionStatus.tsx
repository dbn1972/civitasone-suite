"use client";

import { useEffect, useRef, useState } from "react";
import type { SSEConnectionState } from "./useSSEConnection";

interface SSEConnectionStatusProps {
  /** Current SSE connection state */
  connectionState: SSEConnectionState;
  /** Delay before showing the indicator (ms). Default: 3000 (3 seconds) */
  showDelay?: number;
}

/**
 * Visual indicator shown when the SSE connection is lost for more than `showDelay` ms.
 * Renders nothing when connected.
 * Uses aria-live="polite" for accessibility announcements.
 */
export function SSEConnectionStatus({ connectionState, showDelay = 3000 }: SSEConnectionStatusProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (connectionState === "connected") {
      // Clear timer and hide immediately on reconnection
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisible(false);
    } else {
      // Show after showDelay ms of being disconnected/reconnecting
      if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          setVisible(true);
          timerRef.current = null;
        }, showDelay);
      }
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connectionState, showDelay]);

  if (!visible) return null;

  const label =
    connectionState === "reconnecting"
      ? "Reconnecting to server…"
      : "Connection lost — attempting to reconnect";

  const dotColor = connectionState === "reconnecting" ? "#d97706" : "#dc2626";
  const textColor = connectionState === "reconnecting" ? "#92400e" : "#991b1b";
  const bgColor = connectionState === "reconnecting" ? "#fef3c7" : "#fee2e2";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="sse-connection-status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: textColor,
        background: bgColor,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          animation: connectionState === "reconnecting" ? "pulse 1.5s infinite" : undefined,
        }}
      />
      {label}
    </div>
  );
}
