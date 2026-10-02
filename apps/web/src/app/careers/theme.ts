import type { CSSProperties } from "react";

/**
 * Shared colour tokens for the public careers pages (home, vacancy detail,
 * apply form, candidate portal), so a contrast or brand fix lands in one place
 * (GAP-RECRUITMENT-CAREERS-DETAIL-07 / HOME-08).
 *
 * CAREERS_MUTED is at least 4.5:1 on white and on both page backgrounds
 * (#f8fafc, #f0f4f8), so it is safe for small body/hint text. The old #94a3b8
 * was about 2.6:1 and failed WCAG AA (asserted in theme.test.ts).
 */
export const CAREERS_PRIMARY = "#154089";
export const CAREERS_MUTED = "#5b6b80";
/** Darker amber for the "current step" accent (old #e07b00 was ~3:1 on white). */
export const CAREERS_ACTIVE = "#b45309";
export const CAREERS_ERROR = "#b91c1c";

/** Visually hidden but announced by screen readers. */
export const SR_ONLY: CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};
