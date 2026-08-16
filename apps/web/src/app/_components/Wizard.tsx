"use client";

import React, { useState, type ReactNode } from "react";

export interface WizardStep {
  title: string;
  description?: string;
  content: ReactNode;
  validate?: () => boolean;
}

interface WizardProps {
  steps: WizardStep[];
  onComplete: () => void;
}

export function Wizard({ steps, onComplete }: WizardProps) {
  const [current, setCurrent] = useState(0);

  const canNext = current < steps.length - 1;
  const canPrev = current > 0;
  const isLast = current === steps.length - 1;

  const goNext = () => {
    const step = steps[current];
    if (step.validate && !step.validate()) return;
    if (isLast) {
      onComplete();
    } else {
      setCurrent(current + 1);
    }
  };

  const goPrev = () => {
    if (canPrev) setCurrent(current - 1);
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  background: i < current ? "var(--success,#10b981)" : i === current ? "var(--primary,#4f46e5)" : "var(--border,#e5e7eb)",
                  color: i <= current ? "#fff" : "var(--muted,#6b7280)",
                  transition: "all 0.2s",
                }}
              >
                {i < current ? "✓" : i + 1}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: i === current ? 600 : 400,
                  color: i === current ? "var(--primary,#4f46e5)" : "var(--muted,#6b7280)",
                  marginTop: 4,
                  textAlign: "center",
                  maxWidth: 80,
                }}
              >
                {step.title}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: i < current ? "var(--success,#10b981)" : "var(--border,#e5e7eb)",
                  marginBottom: 18,
                  marginLeft: -20,
                  marginRight: -20,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Current step content */}
      <div
        style={{
          border: "1px solid var(--border,#e5e7eb)",
          borderRadius: 10,
          padding: 24,
          background: "var(--surface,#fff)",
          minHeight: 200,
        }}
      >
        {steps[current].description && (
          <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--muted,#64748b)" }}>
            {steps[current].description}
          </p>
        )}
        {steps[current].content}
      </div>

      {/* Navigation buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <button
          onClick={goPrev}
          disabled={!canPrev}
          type="button"
          style={{
            padding: "8px 20px",
            border: "1px solid var(--border,#d1d5db)",
            borderRadius: 6,
            background: "var(--surface,#fff)",
            color: canPrev ? "var(--ink,#374151)" : "var(--muted,#d1d5db)",
            fontSize: 13,
            fontWeight: 500,
            cursor: canPrev ? "pointer" : "not-allowed",
          }}
        >
          ← Back
        </button>
        <button
          onClick={goNext}
          type="button"
          style={{
            padding: "8px 20px",
            border: "none",
            borderRadius: 6,
            background: isLast ? "#10b981" : "#4f46e5",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {isLast ? "Submit ✓" : "Next →"}
        </button>
      </div>
    </div>
  );
}
