"use client";

import { Fragment } from "react";
import { ACCENT } from "./wizardTypes";

interface Props {
  steps: string[];
  /** 1-indexed current step */
  current: number;
}

export function StepIndicator({ steps, current }: Props) {
  return (
    <nav aria-label="Wizard progress" style={{ marginBottom: 28 }}>
      <ol
        style={{
          display: "flex",
          alignItems: "flex-start",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;

          return (
            <Fragment key={n}>
              <li
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  minWidth: 72,
                }}
                aria-current={active ? "step" : undefined}
              >
                {/* Circle */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: done || active ? ACCENT : "transparent",
                    border: `2px solid ${done || active ? ACCENT : "#cbd5e1"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: done || active ? "#fff" : "var(--muted,#94a3b8)",
                    fontSize: done ? 15 : 13,
                    fontWeight: 700,
                    flexShrink: 0,
                    transition: "background 0.2s, border-color 0.2s",
                  }}
                  aria-hidden="true"
                >
                  {done ? "✓" : n}
                </div>
                {/* Label */}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: active ? 700 : 400,
                    color: active ? ACCENT : done ? "var(--success,#047857)" : "var(--muted,#94a3b8)",
                    textAlign: "center",
                    lineHeight: 1.3,
                    maxWidth: 68,
                  }}
                >
                  {label}
                </span>
              </li>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <li
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    height: 2,
                    background: n < current ? ACCENT : "var(--border,#e2e8f0)",
                    marginTop: 15,
                    minWidth: 12,
                    transition: "background 0.2s",
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
