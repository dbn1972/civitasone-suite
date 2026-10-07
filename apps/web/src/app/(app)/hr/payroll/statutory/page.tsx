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
import {
  ESI_EMPLOYEE_PCT, ESI_EMPLOYER_PCT, ESI_WAGE_CEILING_MINOR, NPS_EMPLOYEE_PCT, NPS_EMPLOYER_PCT,
  PF_EMPLOYEE_PCT, PF_EMPLOYER_PCT, PF_ESI_CHALLAN_DUE_DAY, PF_WAGE_CEILING_MINOR, STATUTORY_REFERENCE_AS_OF,
} from "./_lib/rates";

// GAP-PAYROLL-STATUTORY-01 / -LWF-04 [HUMAN REVIEW: statutory compliance]:
// the hub used to present PT as a flat 2.5%, LWF as 0.5%/1% and "due 15th" on
// every card, contradicting the PT slab table and the LWF fixed-rupee config
// pages, and giving GPF (no challan) a due date. Now:
//  - PT / LWF carry NO percentages or due day: a "state-specific -- see
//    configuration" note replaces them (rateNoteKey).
//  - GPF carries no due day (not a challan-based levy) and no rate: the
//    subscription is chosen per employee (rateNoteKey).
//  - PF / ESI / NPS keep rates but are read from statutory/_lib/rates.ts (one
//    source, also used by the ESI page) and the hub states they are reference
//    values "as of <date>". Only PF and ESI show the 15th challan due day.
// Wage ceilings in paise (minor units).
type StatutoryCardDef = {
  labelKey: "cardPfLabel" | "cardEsiLabel" | "cardPtLabel" | "cardLwfLabel" | "cardNpsLabel" | "cardGpfLabel";
  icon: string;
  empPct?: number;
  erPct?: number;
  rateNoteKey?: "ratePtStateSpecific" | "rateLwfStateSpecific" | "rateGpfPerEmployee";
  wageCeilingMonthly: number | "state" | "none";
  challanDueDay?: number;
  href: string;
};

const STATUTORY_CARD_DEFS: StatutoryCardDef[] = [
  {
    labelKey: "cardPfLabel" as const,
    icon: "🏦",
    empPct: PF_EMPLOYEE_PCT,
    erPct: PF_EMPLOYER_PCT,
    wageCeilingMonthly: PF_WAGE_CEILING_MINOR,
    challanDueDay: PF_ESI_CHALLAN_DUE_DAY,
    href: "/hr/payroll/statutory/pf",
  },
  {
    labelKey: "cardEsiLabel" as const,
    icon: "🩺",
    empPct: ESI_EMPLOYEE_PCT,
    erPct: ESI_EMPLOYER_PCT,
    wageCeilingMonthly: ESI_WAGE_CEILING_MINOR,
    challanDueDay: PF_ESI_CHALLAN_DUE_DAY,
    href: "/hr/payroll/statutory/esi",
  },
  {
    labelKey: "cardPtLabel" as const,
    icon: "📋",
    rateNoteKey: "ratePtStateSpecific" as const,
    // GAP-PAYROLL-STATUTORY-03: PT is a slab table, not a flat ceiling.
    wageCeilingMonthly: "state" as const,
    href: "/hr/payroll/statutory/pt",
  },
  {
    labelKey: "cardLwfLabel" as const,
    icon: "🤝",
    rateNoteKey: "rateLwfStateSpecific" as const,
    wageCeilingMonthly: "state" as const,
    href: "/hr/payroll/statutory/lwf",
  },
  {
    labelKey: "cardNpsLabel" as const,
    icon: "🏛️",
    empPct: NPS_EMPLOYEE_PCT,
    erPct: NPS_EMPLOYER_PCT,
    wageCeilingMonthly: "none" as const,
    href: "/hr/payroll/nps",
  },
  {
    labelKey: "cardGpfLabel" as const,
    icon: "📒",
    rateNoteKey: "rateGpfPerEmployee" as const,
    wageCeilingMonthly: "none" as const,
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
      // GAP-PAYROLL-STATUTORY-02: TDS Returns (24Q/26Q) tile. The orphaned
      // /statutory/gpf and /statutory/nps twins redirect to the canonical
      // /hr/payroll/gpf and /hr/payroll/nps linked above.
      { title: t("tileTdsReturnsTitle"), href: "/hr/payroll/returns", description: t("tileTdsReturnsDescription"), icon: "📄" },
    ];

    const statutoryCards = STATUTORY_CARD_DEFS.map(({ labelKey, rateNoteKey, ...card }) => ({
      ...card,
      label: t(labelKey),
      rateNote: rateNoteKey ? t(rateNoteKey) : undefined,
    }));

    return (
      <div className="page-main wrap">
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
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--ink2)" }}>
            {t("referenceRatesNote", { asOf: STATUTORY_REFERENCE_AS_OF })}
          </p>
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
