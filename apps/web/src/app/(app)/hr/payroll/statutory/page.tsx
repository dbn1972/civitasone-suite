import { getTranslations } from "next-intl/server";
import { LinkTiles } from "../../../../_components/LinkTiles";
import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import type { NavTile } from "@civitasone/types";
import { StatutoryComplianceCard } from "./StatutoryComplianceCard";

// GoI statutory rates — updated per latest FinMin / EPFO / ESIC circulars (Aug 2026)
// Wage ceilings in paise (minor units): EPF wage ceil = ₹15,000 = 1,500,000 minor
// UX-017: labelKey/challanDueDay/etc. are stable identifiers used only to look
// up each card's translated label -- never compared/displayed directly.
const STATUTORY_CARD_DEFS = [
  {
    labelKey: "cardPfLabel" as const,
    icon: "🏦",
    empPct: 12,
    erPct: 12,
    wageCeilingMonthly: 1_500_000, // ₹15,000/mo (EPFO ceiling)
    challanDueDay: 15,
    href: "/hr/payroll/statutory/pf",
  },
  {
    labelKey: "cardEsiLabel" as const,
    icon: "🩺",
    empPct: 0.75,
    erPct: 3.25,
    wageCeilingMonthly: 2_100_000, // ₹21,000/mo (ESIC ceiling)
    challanDueDay: 15,
    href: "/hr/payroll/statutory/esi",
  },
  {
    labelKey: "cardPtLabel" as const,
    icon: "📋",
    empPct: 2.5,
    erPct: 0,
    wageCeilingMonthly: undefined, // State-specific
    challanDueDay: 15,
    href: "/hr/payroll/statutory/pt",
  },
  {
    labelKey: "cardLwfLabel" as const,
    icon: "🤝",
    empPct: 0.5,
    erPct: 1,
    wageCeilingMonthly: undefined, // State-specific
    challanDueDay: 15,
    href: "/hr/payroll/statutory/lwf",
  },
  {
    labelKey: "cardNpsLabel" as const,
    icon: "🏛️",
    empPct: 10,
    erPct: 14,
    wageCeilingMonthly: undefined, // No ceiling
    challanDueDay: 15,
    href: "/hr/payroll/nps",
  },
  {
    labelKey: "cardGpfLabel" as const,
    icon: "📒",
    empPct: 10,
    erPct: 0,
    wageCeilingMonthly: undefined, // No ceiling
    challanDueDay: 15,
    href: "/hr/payroll/gpf",
  },
];

export default async function StatutoryHubPage() {
  try {
    const t = await getTranslations("statutory");

    const tiles: NavTile[] = [
      { title: t("tilePfEcrTitle"), href: "/hr/payroll/statutory/pf", description: t("tilePfEcrDescription") },
      { title: t("tileEsiTitle"), href: "/hr/payroll/statutory/esi", description: t("tileEsiDescription") },
      { title: t("tilePtTitle"), href: "/hr/payroll/statutory/pt", description: t("tilePtDescription") },
      { title: t("tileLwfTitle"), href: "/hr/payroll/statutory/lwf", description: t("tileLwfDescription") },
      { title: t("tileGratuityTitle"), href: "/hr/payroll/statutory/gratuity", description: t("tileGratuityDescription") },
      { title: t("tileChallansTitle"), href: "/hr/payroll/statutory/challans", description: t("tileChallansDescription") },
      { title: t("tilePerquisiteTitle"), href: "/hr/payroll/statutory/perquisite", description: t("tilePerquisiteDescription") },
      { title: t("tileGpfTitle"), href: "/hr/payroll/gpf", description: t("tileGpfDescription") },
      { title: t("tileNpsTitle"), href: "/hr/payroll/nps", description: t("tileNpsDescription") },
    ];

    const statutoryCards = STATUTORY_CARD_DEFS.map((def) => ({ ...def, label: t(def.labelKey) }));

    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/hr/payroll" backLabel="Back to Payroll"
        />

        <Card title={t("summaryCardTitle")}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {statutoryCards.map((card) => (
              <StatutoryComplianceCard key={card.href} {...card} />
            ))}
          </div>
        </Card>

        <div style={{ marginTop: 24 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--fg)",
              marginBottom: 12,
            }}
          >
            {t("allModulesHeading")}
          </h2>
          <LinkTiles tiles={tiles} columns="three" />
        </div>
      </main>
    );
  } catch {
    return (
      <main className="page-main wrap">
        <RefreshErrorState error={toHumanError("load", { area: "statutory compliance" })} backHref="/hr/payroll" />
      </main>
    );
  }
}
