/**
 * SlaBadge — surfaces helpdesk SLA status as a text + icon badge.
 *
 * Accessibility: status is conveyed by an icon (aria-hidden) AND a text label,
 * never by colour alone, satisfying WCAG 1.4.1 (Use of Colour). The whole badge
 * carries an aria-label so screen readers announce "SLA: Breached" etc.
 *
 * Route-local helper for the Helpdesk module (consumes DS tokens only).
 */

type Tone = "good" | "warn" | "bad" | "mut";

// GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03: labels now come from the shared
// SLA_LABELS vocabulary (lib/slaLabels.ts) so this badge, My Requests and the
// breach report never disagree on wording; icon + tone stay badge-local.
import { SLA_LABELS } from "@/lib/slaLabels";

const SLA_MAP: Record<string, { label: string; icon: string; tone: Tone }> = {
  within_sla: { label: SLA_LABELS.within_sla, icon: "✓", tone: "good" },
  due_soon: { label: SLA_LABELS.due_soon, icon: "⏳", tone: "warn" },
  at_risk: { label: SLA_LABELS.at_risk, icon: "⏳", tone: "warn" },
  breached: { label: SLA_LABELS.breached, icon: "⚠", tone: "bad" },
};

export function SlaBadge({ status }: { status?: string | null }) {
  const key = (status ?? "").toLowerCase().replace(/[\s-]/g, "_");
  const meta = SLA_MAP[key] ?? {
    label: status ? status.replace(/_/g, " ") : "Unknown",
    icon: "•",
    tone: "mut" as Tone,
  };

  return (
    <span
      className={`pill ${meta.tone}`}
      aria-label={`SLA: ${meta.label}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}
