import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getRecNba, getRecMatrix, getRecHealth, getRecFeedback } from "./_data";

export const dynamic = "force-dynamic";

/**
 * GAP-RECOMMENDATIONS-HOME-02: a count badge from a loaded child endpoint, or
 * "—" when that endpoint failed — never a fabricated 0 (NavTile.badge contract).
 */
function countBadge(source: "api" | "error", count: number, noun: string): NavTile["badge"] {
  if (source === "error") return { text: "—", tone: "info" };
  return { text: `${count} ${noun}`, tone: count > 0 ? "warn" : "info" };
}

export default async function Page() {
  // One failed endpoint must not blank the hub, so each is settled independently.
  const [nba, matrix, health, feedback] = await Promise.all([
    getRecNba(),
    getRecMatrix(),
    getRecHealth(),
    getRecFeedback(),
  ]);

  const sections: NavTile[] = [
    {
      title: "Next Best Action",
      description: "Recent next-best-action signals for each customer or record.",
      href: "/recommendations/nba",
      badge: countBadge(nba.source, nba.data.length, "scored"),
    },
    {
      title: "Cross-Sell Matrix",
      description: "Product affinity rules (read-only).",
      href: "/recommendations/matrix",
      badge: countBadge(matrix.source, matrix.data.length, "rules"),
    },
    {
      title: "Health Scores",
      description: "Accounts in the at-risk and critical health bands.",
      href: "/recommendations/health",
      badge: countBadge(health.source, health.data.length, "at risk"),
    },
    {
      title: "Feedback",
      description: "Why recommendations were rejected, grouped by reason.",
      href: "/recommendations/feedback",
      badge: countBadge(feedback.source, feedback.data.totalRejections, "rejected"),
    },
  ];

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader title="Recommendations" subtitle="Next-best-action and cross-sell signals." help="recommendations" />
      <LinkTiles tiles={sections} columns="four" />
    </div>
  );
}
