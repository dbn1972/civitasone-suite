/**
 * StatusBadge — text + icon status indicator for the notifications module.
 *
 * The shared DS StatusPill is colour-only; this WCAG-safe variant pairs every
 * state with an aria-hidden glyph AND its text label, so status is never
 * conveyed by colour alone (WCAG 1.4.1). It reuses the DS `.pill` colour
 * variants for visual consistency but adds the icon + an accessible label.
 */
type Variant = "good" | "warn" | "mut" | "bad" | "info";

type StateDef = { icon: string; variant: Variant; label: string };

const STATES: Record<string, StateDef> = {
  // deliveries
  delivered: { icon: "✓", variant: "good", label: "Delivered" },
  sent:      { icon: "✓", variant: "good", label: "Sent" },
  pending:   { icon: "•", variant: "warn", label: "Pending" },
  queued:    { icon: "•", variant: "warn", label: "Queued" },
  failed:    { icon: "✕", variant: "bad", label: "Failed" },
  bounced:   { icon: "↩", variant: "bad", label: "Bounced" },
  // inbox notifications
  read:      { icon: "○", variant: "mut", label: "Read" },
  // templates
  active:    { icon: "✓", variant: "good", label: "Active" },
  superseded:{ icon: "↪", variant: "mut", label: "Superseded" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = String(status ?? "").toLowerCase();
  const def = STATES[key] ?? { icon: "•", variant: "info" as Variant, label: status || "Unknown" };
  const text = label ?? def.label;
  return (
    <span className={`pill ${def.variant}`} aria-label={`Status: ${text}`}>
      <span aria-hidden="true" style={{ marginRight: 4 }}>{def.icon}</span>
      {text}
    </span>
  );
}
