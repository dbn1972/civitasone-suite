import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LinkTiles } from "../../../../_components/LinkTiles";
import { PageHeader, Card, RefreshErrorState } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import type { NavTile } from "@civitasone/types";
import { StatutoryComplianceCard } from "./StatutoryComplianceCard";

// GoI statutory rates — updated per latest FinMin / EPFO / ESIC circulars (Aug 2026)
// Wage ceilings in paise (minor units): EPF wage ceil = ₹15,000 = 1,500,000 minor
// UX-017: labelKey/challanDueDay/etc. are stable identifiers used only to look
// up each card's translated label -- never compared/displayed directly.
//
// GAP-PAYROLL-STATUTORY-01 [HUMAN REVIEW: statutory compliance] -- whether
// PF/ESI/NPS/GPF should keep showing these rates at all (vs. a "reference
// value, as of <date>" label or a future config-endpoint read), and whether
// PT/LWF/GPF should drop challanDueDay entirely, is a product/compliance
// decision this pass deliberately leaves OPEN (see payroll.md's own
// "Needs: decision" tag on this item and the PR description). Nothing in
// this file resolves that decision; only the wageCeilingMonthly values below
// changed (GAP-PAYROLL-STATUTORY-03, a narrower and unrelated fix -- a
// "state-specific" ceiling is not the same claim as "no ceiling").
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
    // GAP-PAYROLL-STATUTORY-03: PT is a slab table, not a flat ceiling --
    // "state" (not undefined/"none") so the card says "State-specific"
    // instead of the wrong "No ceiling".
    wageCeilingMonthly: "state" as const,
    challanDueDay: 15,
    href: "/hr/payroll/statutory/pt",
  },
  {
    labelKey: "cardLwfLabel" as const,
    icon: "🤝",
    empPct: 0.5,
    erPct: 1,
    // GAP-PAYROLL-STATUTORY-03: LWF is fixed rupee amounts per state, same
    // "state-specific" ceiling story as PT above.
    wageCeilingMonthly: "state" as const,
    challanDueDay: 15,
    href: "/hr/payroll/statutory/lwf",
  },
  {
    labelKey: "cardNpsLabel" as const,
    icon: "🏛️",
    empPct: 10,
    erPct: 14,
    wageCeilingMonthly: "none" as const, // No ceiling
    challanDueDay: 15,
    href: "/hr/payroll/nps",
  },
  {
    labelKey: "cardGpfLabel" as const,
    icon: "📒",
    empPct: 10,
    erPct: 0,
    wageCeilingMonthly: "none" as const, // No ceiling
    challanDueDay: 15,
    href: "/hr/payroll/gpf",
  },
];

export default async function StatutoryHubPage() {
  try {
    const t = await getTranslations("statutory");

    // GAP-PAYROLL-STATUTORY-04: hr/layout.tsx admits employee/manager to every
    // /hr/payroll/* URL. Every statutory sub-page already gates itself on
    // PAYROLL_STATUTORY_ADMIN_ROLES (PR #1761 / #1753, mirroring
    // payroll-service's READER_ROLES); the hub was the one page left open.
    // Same list and same PermissionDenied pattern as those sub-pages -- no
    // layout-level gate, so there is exactly one role list per page.
    const roles = getSessionRoles();
    if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
      return <PermissionDenied module="statutory compliance" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll" backLabel={t("errorBackLabel")} />;
    }

    const tiles: NavTile[] = [
      { title: t("tilePfEcrTitle"), href: "/hr/payroll/statutory/pf", description: t("tilePfEcrDescription"), icon: "🏦" },
      { title: t("tileEsiTitle"), href: "/hr/payroll/statutory/esi", description: t("tileEsiDescription"), icon: "🩺" },
      { title: t("tilePtTitle"), href: "/hr/payroll/statutory/pt", description: t("tilePtDescription"), icon: "📋" },
      { title: t("tileLwfTitle"), href: "/hr/payroll/statutory/lwf", description: t("tileLwfDescription"), icon: "🤝" },
      { title: t("tileGratuityTitle"), href: "/hr/payroll/statutory/gratuity", description: t("tileGratuityDescription"), icon: "🎖️" },
      { title: t("tileChallansTitle"), href: "/hr/payroll/statutory/challans", description: t("tileChallansDescription"), icon: "🧾" },
      { title: t("tilePerquisiteTitle"), href: "/hr/payroll/statutory/perquisite", description: t("tilePerquisiteDescription"), icon: "📜" },
      { title: t("tileGpfTitle"), href: "/hr/payroll/gpf", description: t("tileGpfDescription"), icon: "📒" },
      { title: t("tileNpsTitle"), href: "/hr/payroll/nps", description: t("tileNpsDescription"), icon: "🏛️" },
      // GAP-PAYROLL-STATUTORY-02 (partial): the hub omitted a TDS Returns
      // (24Q/26Q) tile entirely -- it is reachable from the HR hub
      // (hr/page.tsx) but not from this statutory hub. Adding the missing
      // tile is additive and uncontroversial; the separate question of
      // whether /hr/payroll/statutory/gpf and /nps (orphaned twins of the
      // two routes linked above) should be deleted or redirected is a
      // canonical-route decision left OPEN -- see the PR description.
      { title: t("tileTdsReturnsTitle"), href: "/hr/payroll/returns", description: t("tileTdsReturnsDescription"), icon: "📄" },
    ];

    const statutoryCards = STATUTORY_CARD_DEFS.map((def) => ({ ...def, label: t(def.labelKey) }));

    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/hr/payroll" backLabel={t("errorBackLabel")}
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
          {/* GAP-PAYROLL-STATUTORY-04: this used to repeat as non-link text
              inside all six cards above (StatutoryComplianceCard.tsx) --
              one real, working link here instead. */}
          <p style={{ marginTop: 12, fontSize: 12 }}>
            <Link href="/hr/payroll/statutory/challans" style={{ color: "var(--accent, #2563eb)", fontWeight: 600 }}>
              {t("seeChallansForFilingStatus")}
            </Link>
          </p>
        </Card>

        <div style={{ marginTop: 24 }}>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--ink)",
              marginBottom: 12,
            }}
          >
            {t("allModulesHeading")}
          </h2>
          <LinkTiles tiles={tiles} columns="three" />
        </div>
      </div>
    );
  } catch {
    return (
      <div className="page-main wrap">
        <RefreshErrorState error={toHumanError("load", { area: "statutory compliance" })} backHref="/hr/payroll" />
      </div>
    );
  }
}
