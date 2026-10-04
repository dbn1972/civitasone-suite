"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs } from "../../../../_components/ds";
import type { DetailTab } from "./payGroupMembership";

/** URL-driven tab strip (`?tab=details|members`) so a members link is shareable and the page stays server-rendered. */
export function PayGroupTabs({ payGroupId, active }: { payGroupId: string; active: DetailTab }) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const labels: Record<DetailTab, string> = { details: t("tabDetails"), members: t("tabMembers") };
  return (
    <Tabs
      tabs={[labels.details, labels.members]}
      active={labels[active]}
      ariaLabel={t("tabsAria")}
      onChange={(label) => {
        const next: DetailTab = label === labels.members ? "members" : "details";
        router.push(`/hr/payroll/pay-groups/${payGroupId}?tab=${next}`);
      }}
    />
  );
}
