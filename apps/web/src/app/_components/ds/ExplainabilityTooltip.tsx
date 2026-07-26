"use client";

import { useId, useState, useRef, useEffect, type ReactNode } from "react";

export interface ExplainabilityFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

export interface ExplainabilityTooltipProps {
  /** Factor contributions to display */
  factors: ExplainabilityFactor[];
  /** Trigger element (wrapped for hover/focus behavior) */
  children: ReactNode;
}

/**
 * ExplainabilityTooltip — hover/focus popover showing factor contribution bars.
 * Displays positive (green) and negative (red) direction indicators.
 * Keyboard accessible: appears on focus, closes on Escape.
 */
export function ExplainabilityTooltip({ factors, children }: ExplainabilityTooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!factors || factors.length === 0) {
    return <>{children}</>;
  }

  const maxContribution = Math.max(...factors.map((f) => Math.abs(f.contribution)), 1);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute top-full start-0 z-50 mt-2 w-64 rounded-lg bg-gray-900 p-3 text-white shadow-lg dark:bg-gray-800"
        >
          <span className="mb-2 block text-xs font-semibold text-gray-300">
            Key Factors
          </span>
          <ul className="space-y-2" aria-label="Factor contributions">
            {factors.map((factor) => {
              const barWidth = Math.round((Math.abs(factor.contribution) / maxContribution) * 100);
              const isPositive = factor.direction === "positive";
              return (
                <li key={factor.feature} className="text-xs">
                  <span className="mb-0.5 flex items-center justify-between">
                    <span className="truncate font-medium">{factor.feature}</span>
                    <span
                      className={isPositive ? "text-green-400" : "text-red-400"}
                      aria-label={`${factor.feature}: ${isPositive ? "positive" : "negative"} contribution`}
                    >
                      {isPositive ? "+" : "−"}
                    </span>
                  </span>
                  <span className="block h-1.5 w-full rounded-full bg-gray-700">
                    <span
                      className={`block h-full rounded-full ${isPositive ? "bg-green-500" : "bg-red-500"}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </span>
      )}
    </span>
  );
}
