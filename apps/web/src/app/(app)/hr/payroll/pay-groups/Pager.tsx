import Link from "next/link";
import { useTranslations } from "next-intl";
import { pageWindow } from "./payGroupMembership";

/** Prev/next links over a limit/offset page; `hrefFor` builds the URL for an offset. */
export function Pager({
  total, limit, offset, hrefFor,
}: {
  total: number;
  limit: number;
  offset: number;
  hrefFor: (offset: number) => string;
}) {
  const t = useTranslations("payGroupMembers");
  const w = pageWindow(total, limit, offset);
  return (
    <nav aria-label={t("pagerAria")} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
      <span role="status">{t("pagerSummary", { from: w.from, to: w.to, total })}</span>
      {w.prevOffset !== null && (
        <Link href={hrefFor(w.prevOffset)} className="btn ghost" style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}>
          {t("pagerPrev")}
        </Link>
      )}
      {w.nextOffset !== null && (
        <Link href={hrefFor(w.nextOffset)} className="btn ghost" style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}>
          {t("pagerNext")}
        </Link>
      )}
    </nav>
  );
}
