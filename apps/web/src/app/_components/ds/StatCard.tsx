import { ArrowUp, ArrowDown } from "lucide-react";
import { StatIcon } from "./StatIcon";

interface StatCardProps {
  icon: string;
  iconBg?: string;
  label: string;
  value: string | number | null | undefined;
  delta?: string;
  up?: boolean;
}

// A stat with no real value to show (fetch failed, not yet known) must read
// as "we don't know", not as a fabricated zero -- a hard `0` or `₹0.00` is
// visually indistinguishable from a genuine zero (UX-013-style bug). This
// mirrors the "—" convention pages already use when they gate on their own
// fetch `source` (projects/dashboard, estab/dashboard). Doing it here too
// means a caller that simply passes a null/undefined/NaN value through on
// error -- instead of remembering its own `errored ? "—" : value` ternary
// on every stat -- still renders correctly by default.
function displayValue(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  return value;
}

export function StatCard({ icon, iconBg, label, value, delta, up }: StatCardProps) {
  return (
    <div className="stat">
      <div className="top">
        <div />
        <div className="ic" style={{ background: iconBg ?? "#eef2ff", lineHeight: 1 }} aria-hidden>
          <StatIcon icon={icon} />
        </div>
      </div>
      <div className="lab">{label}</div>
      <div className="val">{displayValue(value)}</div>
      {delta && (
        <div className={`delta ${up ? "up" : "down"}`}>
          {/*
            No `aria-label` here: axe's aria-prohibited-attr rule flags aria-label
            on a plain <div> (role="generic") as not permitted. The accessible
            name it carried is preserved instead via visually-hidden text, same
            pattern as ApprovalChainBuilder's Before/After labels.

            An icon, not a "↑"/"↓" text glyph, for the same reason: axe's
            color-contrast rule cannot reliably measure contrast for
            decorative Unicode arrow characters ("nonBmp" / non-text content)
            and treats that as an undecided, blocking result.
          */}
          <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "-2px" }}>
            {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          </span>{" "}
          <span className="sr-only">{up ? "Increase" : "Decrease"} of </span>
          {delta}
        </div>
      )}
    </div>
  );
}
