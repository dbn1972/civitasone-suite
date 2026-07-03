"use client";

import { useEffect } from "react";

/**
 * A checkmark animation shown after successful form submissions.
 * Pure CSS animation: green circle scales in → checkmark draws → fades out.
 */

interface SuccessAnimationProps {
  visible: boolean;
  onComplete?: () => void;
}

export function SuccessAnimation({ visible, onComplete }: SuccessAnimationProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      onComplete?.();
    }, 2000);
    return () => clearTimeout(timer);
  }, [visible, onComplete]);

  if (!visible) return null;

  return (
    <div
      className="success-animation-overlay"
      role="status"
      aria-label="Success"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "fade-out 0.3s ease 1.7s forwards",
      }}
    >
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        style={{ animation: "scale-in 0.3s ease forwards" }}
      >
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="#22c55e"
          style={{ animation: "scale-in 0.3s ease forwards" }}
        />
        <path
          d="M20 33 L28 41 L44 25"
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 40,
            strokeDashoffset: 40,
            animation: "draw-check 0.4s ease 0.3s forwards",
          }}
        />
      </svg>
    </div>
  );
}
