import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getLegalNotices } from "../../../_data/loaders";
import { NoticesTable } from "./NoticesTable";

export default async function LegalNoticesPage() {
  const t = await getTranslations("legalNotices");
  const { data: items, source } = await getLegalNotices();
  const dash = (n: number): number | string => (source === "error" ? "—" : n);
  const open = items.filter((i) => i.status === "open").length;
  const responded = items.filter((i) => i.status === "responded").length;

  return (
    <div className="wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<Link href="/legal/notices/new" className="btn primary">{t("issueNotice")}</Link>}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📨" tone="neutral" label={t("statTotal")} value={dash(items.length)} />
        <StatCard icon="⏳" tone="warn" label={t("statOpen")} value={dash(open)} />
        <StatCard icon="✅" tone="good" label={t("statResponded")} value={dash(responded)} />
      </div>
      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "legal notices" })} backHref="/legal" />
      ) : (
        <NoticesTable items={items} source={source} />
      )}
    </div>
  );
}
