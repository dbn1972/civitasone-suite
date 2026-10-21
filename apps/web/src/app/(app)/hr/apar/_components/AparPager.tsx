import Link from "next/link";
import { useTranslations } from "next-intl";
import { pageWindow } from "@/lib/apar/paging";

/**
 * GAP-HR-APAR-06: previous/next paging for the APAR list. Plain links (the
 * list is a server-rendered page driven by `?page=`), so it works without
 * client JS and every page is a shareable URL. `hrefFor(page)` builds the
 * URL for a 1-based page, keeping the active status/period/search filters.
 */
export function AparPager({
  total, offset, shown, hrefFor,
}: {
  total: number;
  offset: number;
  shown: number;
  hrefFor: (page: number) => string;
}) {
  const t = useTranslations("apar");
  const w = pageWindow(total, offset, shown);
  return (
    <nav
      aria-label={t("pagerAria")}
      style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}
    >
      <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>
        {w.from > 0 ? t("pagerSummary", { from: w.from, to: w.to, total }) : t("pagerBeyondEnd", { total })}
      </span>
      {w.prevPage !== null && (
        <Link href={hrefFor(w.prevPage)} rel="prev" className="btn ghost" style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}>
          {t("pagerPrev")}
        </Link>
      )}
      {w.nextPage !== null && (
        <Link href={hrefFor(w.nextPage)} rel="next" className="btn ghost" style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}>
          {t("pagerNext")}
        </Link>
      )}
    </nav>
  );
}
