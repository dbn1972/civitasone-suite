"use client";

/**
 * FN-32 — Accessibility & GIGW preview, shown before publish.
 *
 * BRD acceptance: "form missing labels fails preview with actionable list."
 * The list is the deliverable, not the verdict — a designer needs to know which
 * field to fix and why, so every row names the field, quotes the WCAG criterion
 * and says what to change. A bare "failed" badge would satisfy the letter of the
 * requirement and none of its purpose.
 *
 * Errors and warnings are visually distinct and separately counted because they
 * mean different things: errors block, warnings (GIGW bilingual, missing help
 * text) are rollout obligations that must not stop a correct English-first pilot.
 */

import { useEffect, useState } from "react";
import { fetchA11yPreview, type A11yPreviewDto } from "../_data/designerApi";

export function AccessibilityPreview({ definitionId }: { definitionId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<A11yPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchA11yPreview(definitionId)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not run the accessibility preview.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  if (state === "loading") {
    return (
      <section aria-labelledby="a11y-heading" style={panel}>
        <h2 id="a11y-heading" style={heading}>Accessibility &amp; GIGW</h2>
        <p style={muted}>Checking the form…</p>
      </section>
    );
  }

  if (state === "error" || !preview) {
    return (
      <section aria-labelledby="a11y-heading" style={panel}>
        <h2 id="a11y-heading" style={heading}>Accessibility &amp; GIGW</h2>
        {/* Say the check did not run. Silence here would read as "no problems". */}
        <p style={{ ...muted, color: "#b42318" }} role="status">
          {error ?? "Could not run the accessibility preview."}
        </p>
      </section>
    );
  }

  const errors = preview.issues.filter((i) => i.severity === "error");
  const warnings = preview.issues.filter((i) => i.severity === "warning");

  return (
    <section aria-labelledby="a11y-heading" style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 id="a11y-heading" style={heading}>Accessibility &amp; GIGW</h2>
        <span style={preview.passed ? badgePass : badgeFail} role="status">
          {!preview.formAuthored ? "No form yet" : preview.passed ? "Passes" : `${preview.errorCount} to fix`}
        </span>
      </div>

      {!preview.formAuthored ? (
        <p style={muted}>{preview.reason}</p>
      ) : preview.issues.length === 0 ? (
        <p style={muted}>
          Every field has a label, every section a heading, and the tab order is complete.
        </p>
      ) : (
        <>
          {errors.length > 0 && (
            <>
              <h3 style={subheading}>Must fix before publishing</h3>
              <ul style={list}>
                {errors.map((issue, i) => (
                  <li key={`${issue.code}-${issue.fieldId ?? issue.sectionId ?? i}`} style={rowError}>
                    <span style={{ fontWeight: 600 }}>{issue.message}</span>
                    <span style={meta}>
                      WCAG {issue.wcag}
                      {issue.fieldId ? ` · field ${issue.fieldId}` : ""}
                      {issue.sectionId ? ` · section ${issue.sectionId}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {warnings.length > 0 && (
            <>
              <h3 style={subheading}>Recommended</h3>
              <ul style={list}>
                {warnings.map((issue, i) => (
                  <li key={`${issue.code}-${issue.fieldId ?? i}`} style={rowWarn}>
                    <span>{issue.message}</span>
                    <span style={meta}>
                      {issue.wcag}
                      {issue.fieldId ? ` · field ${issue.fieldId}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Honesty about scope: this is a design-time check, not a rendered-page
          audit. Saying so stops a green badge being read as full WCAG sign-off. */}
      <p style={{ ...muted, fontSize: 12, marginTop: 12 }}>
        Checks the form definition — labels, headings, tab order and instructions. Colour
        contrast and screen-reader behaviour depend on the theme and are checked at runtime.
      </p>
    </section>
  );
}

const panel: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: 16,
  background: "#fff",
};
const heading: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: 0 };
const subheading: React.CSSProperties = { fontSize: 13, fontWeight: 600, margin: "14px 0 6px" };
const muted: React.CSSProperties = { color: "#475467", fontSize: 14, margin: "8px 0 0" };
const meta: React.CSSProperties = { color: "#667085", fontSize: 12 };
const list: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 };
const rowBase: React.CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 14,
};
const rowError: React.CSSProperties = { ...rowBase, background: "#fef3f2", border: "1px solid #fda29b" };
const rowWarn: React.CSSProperties = { ...rowBase, background: "#fffaeb", border: "1px solid #fec84b" };
const badgeBase: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: 999,
};
const badgePass: React.CSSProperties = { ...badgeBase, background: "#ecfdf3", color: "#027a48" };
const badgeFail: React.CSSProperties = { ...badgeBase, background: "#fef3f2", color: "#b42318" };
