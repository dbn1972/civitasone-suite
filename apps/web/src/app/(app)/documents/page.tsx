import Link from "next/link";
import { PageHeader, StatCard } from "../../_components/ds";
import { getDocumentStats } from "./_data/loaders";

/**
 * GAP-DOCUMENTS-HOME-01: /documents is now a small landing hub with two cards
 * (e-Office Inbox and Document Library) rather than a blanket redirect to the
 * Library. A clerk who lives in the inbox reaches it in one click from here
 * instead of always landing on the Library and clicking across.
 *
 * Decision: a neutral two-card landing (no cookie/role auto-redirect) is the
 * safest default — it never guesses wrong for a given clerk and needs no new
 * preference storage. A remembered last-used preference can be layered on later.
 */
export default async function DocumentsHome() {
  const { data: stats, source } = await getDocumentStats();
  const ok = source !== "error";

  return (
    <div className="wrap">
      <PageHeader title="Documents" subtitle="e-Office inbox and the document library." />

      <div className="grid g-2" style={{ marginTop: 18, gap: 16 }}>
        <Link href="/documents/inbox" style={{ textDecoration: "none" }}>
          <StatCard icon="📥" iconBg="var(--panel)" label="e-Office Inbox" value={ok ? stats.inboxCount.toLocaleString("en-IN") : "—"} />
        </Link>
        <Link href="/documents/library" style={{ textDecoration: "none" }}>
          <StatCard icon="🗂️" iconBg="var(--panel)" label="Document Library" value="Open" />
        </Link>
      </div>
    </div>
  );
}
