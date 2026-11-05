import Link from "next/link";
import { INBOX_TABS, type InboxCounts, type InboxTab, type ModuleKey } from "../_lib/inboxModel";
import styles from "./inbox.module.css";

/**
 * The three inbox tabs. Rendered by the client inbox with its LIVE counts (they change after each
 * decision, together with the sidebar badge), and by the page on a failed load (no counts then).
 */
export function InboxTabs({ tab, counts, module, labels }: {
  tab: InboxTab;
  counts: InboxCounts | null;
  module: ModuleKey | "all";
  labels: { nav: string } & Record<InboxTab, string>;
}) {
  const href = (k: InboxTab) => `/approvals?tab=${k}${module !== "all" ? `&module=${module}` : ""}`;
  return (
    <nav aria-label={labels.nav}>
      <ul className={styles.tabs}>
        {INBOX_TABS.map((k) => (
          <li key={k}>
            <Link href={href(k)} className={styles.tab} aria-current={k === tab ? "page" : undefined}>
              {labels[k]}
              {counts && <span className={styles.count}>{counts[k]}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
