import { ArrowUp, ArrowDown } from "lucide-react";

interface StatCardProps {
  icon: string;
  iconBg?: string;
  label: string;
  value: string | number;
  delta?: string;
  up?: boolean;
}

export function StatCard({ icon, iconBg, label, value, delta, up }: StatCardProps) {
  return (
    <div className="stat">
      <div className="top">
        <div />
        <div className="ic" style={{ background: iconBg ?? "#eef2ff", lineHeight: 1 }} aria-hidden>{icon}</div>
      </div>
      <div className="lab">{label}</div>
      <div className="val">{value}</div>
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
