/**
 * GAP-NOTIFICATIONS-TEMPLATES-03: a single source of truth for turning a raw
 * channel key (email | sms | in_app | push | whatsapp | webhook) into a
 * human label. The template pages previously printed `channel.replace(/_/g," ")`
 * which renders "in app" / "sms" rather than "In-app" / "SMS". Mirrors the
 * CHANNELS list used by the compose page.
 *
 *   channelLabel("in_app") -> "In-app"
 *   channelLabel("sms")    -> "SMS"
 *   channelLabel("email")  -> "Email"
 *
 * An unknown key is Title-cased with underscores turned to spaces so an
 * unexpected backend value is still readable rather than hidden.
 */
const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
  push: "Push",
  whatsapp: "WhatsApp",
  webhook: "Webhook",
};

export function channelLabel(channel: string | null | undefined): string {
  const key = String(channel ?? "").trim().toLowerCase();
  if (key === "") return "—";
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  return key
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
