import { useTranslations } from "next-intl";
import { formatIndianDate } from "@/lib/formatters";

/**
 * GAP-HR-SOCIAL-FEED-05: one row of the social feed, extracted from the page so
 * the four row kinds share one layout and one set of design-system tokens.
 * Every colour below is a token that civitas-ds.css defines for BOTH themes
 * (--warnbg / --goodbg / --infobg / --line / --line2 / --ink / --ink2 / --mut,
 * overridden under .dark); the page used to reference --bg2 and --primary-l,
 * which are defined nowhere and resolved to nothing. The type of each row is
 * carried by a visually hidden label next to the aria-hidden emoji, so a screen
 * reader hears "Birthday", "Kudos", ... instead of an unnamed glyph.
 */
export type FeedItem = {
  type: string;
  id: string;
  createdAt: string;
  giver_name?: string;
  receiver_name?: string;
  badge?: string;
  reactions?: number;
  message?: string;
  name?: string;
  department?: string;
  designation?: string;
  title?: string;
  body?: string;
  category?: string;
  pinned?: boolean;
  author?: string;
  joiningDate?: string;
} & Record<string, unknown>;

// GAP-HR-SOCIAL-FEED-04: this used to be indexed with `item.badge ?? "star"`
// directly, so any badge value outside these 7 keys (a legacy/stored value,
// or the map going stale relative to the API's own enum) rendered an empty
// 28px slot instead of falling back visibly. `badgeEmoji()` always returns a
// real emoji.
const BADGE_EMOJI: Record<string, string> = {
  star: "⭐", rocket: "🚀", heart: "❤️", trophy: "🏆", fire: "🔥", lightning: "⚡", thumbsup: "👍",
};
export function badgeEmoji(badge: string | undefined): string {
  return (badge && BADGE_EMOJI[badge]) || BADGE_EMOJI.star || "⭐";
}

type Tone = "plain" | "warn" | "good" | "info";
const TONE_BG: Record<Tone, string> = {
  plain: "transparent",
  warn: "var(--warnbg)",
  good: "var(--goodbg)",
  info: "var(--infobg)",
};

const ROW: React.CSSProperties = { display: "flex", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--line)" };
const HEAD: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
const DATE: React.CSSProperties = { fontSize: 11, color: "var(--mut)", whiteSpace: "nowrap" };

function Row({
  tone, emoji, emojiSize, typeLabel, centered, children,
}: {
  tone: Tone; emoji: string; emojiSize: number; typeLabel: string; centered?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ ...ROW, background: TONE_BG[tone], alignItems: centered ? "center" : undefined }}>
      <span style={{ fontSize: emojiSize, flexShrink: 0 }} aria-hidden="true">{emoji}</span>
      <span className="sr-only">{typeLabel}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export function FeedRow({ item }: { item: FeedItem }) {
  const t = useTranslations("socialFeed");
  const date = <span style={DATE}>{formatIndianDate(item.createdAt)}</span>;

  if (item.type === "kudos") {
    return (
      <Row tone="plain" emoji={badgeEmoji(item.badge)} emojiSize={28} typeLabel={t("kudosTypeLabel")}>
        <div style={HEAD}>
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t.rich("kudosLine", {
              giver: item.giver_name ?? "",
              receiver: item.receiver_name ?? "",
              strongGiver: (chunks) => <strong>{chunks}</strong>,
              strongReceiver: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {/* GAP-HR-SOCIAL-FEED-03: every feed item already carries createdAt;
              rendered for all 4 item types, not just this one. */}
          {date}
        </div>
        {Number(item.reactions ?? 0) > 0 && (
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--mut)" }}>
            {t("reactionsCount", { count: Number(item.reactions) })}
          </p>
        )}
        {item.message && (
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink2)", background: "var(--line2)", borderRadius: 8, padding: "8px 12px", fontStyle: "italic" }}>
            {item.message}
          </p>
        )}
      </Row>
    );
  }

  if (item.type === "birthday") {
    return (
      <Row tone="warn" emoji="🎂" emojiSize={32} typeLabel={t("birthdayTypeLabel")} centered>
        <div style={HEAD}>
          <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("birthdayGreeting", { name: item.name ?? "" })}</p>
          {date}
        </div>
        <p style={{ fontSize: 12, color: "var(--mut)" }}>{item.designation} · {item.department}</p>
      </Row>
    );
  }

  if (item.type === "new_joinee") {
    return (
      <Row tone="good" emoji="👋" emojiSize={32} typeLabel={t("newJoineeTypeLabel")} centered>
        <div style={HEAD}>
          <p style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{t("newJoineeGreeting", { name: item.name ?? "" })}</p>
          {date}
        </div>
        <p style={{ fontSize: 12, color: "var(--mut)" }}>{t("joinedAsLine", { designation: item.designation ?? "", department: item.department ?? "" })}</p>
      </Row>
    );
  }

  if (item.type === "announcement") {
    return (
      <Row tone={item.pinned ? "info" : "plain"} emoji={item.pinned ? "📌" : "📢"} emojiSize={24} typeLabel={t("announcementTypeLabel")}>
        <div style={HEAD}>
          <p style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</p>
          {date}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>{item.body}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {item.category && <span className="pill info np">{item.category}</span>}
          {item.author && <span style={{ fontSize: 11, color: "var(--mut)" }}>{t("byAuthorLine", { author: item.author })}</span>}
        </div>
      </Row>
    );
  }

  return null;
}
