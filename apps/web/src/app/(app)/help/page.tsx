import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader, Card, EmptyState } from "../../_components/ds";
import { ReplayTourButton } from "./ReplayTourButton";
import { GlossaryList } from "./GlossaryList";
import { HELP_MODULES } from "@/lib/helpContent";
import { collapseGlossary } from "@/lib/glossary";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export const metadata = {
  title: "Help Centre",
};

/**
 * Help Centre hub — a plain-language home for "how do I…?" questions.
 * Lists a short guide for the main modules, plus a glossary of the specialist
 * words used across the system. Written for a first-time clerk with no
 * training. Not every module in the nav has a guide yet (GAP-HELP-HOME-01);
 * the hub says so and points to Helpdesk for anything not listed. Module guides
 * are filtered to the tenant's enabled modules (R13.2); when enablement is
 * unknown, all are shown.
 */
export default async function HelpPage() {
  const t = await getTranslations("help");
  const enabled = await getEnabledModules();
  const roles = getSessionRoles();
  const visibleModules = HELP_MODULES.filter((m) => isModuleEnabled(enabled, m.moduleKey, roles));

  const glossaryRows = collapseGlossary();

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={<ReplayTourButton />}
      />

      <h2 style={{ fontSize: 16, margin: "8px 0 12px" }}>{t("guidesHeading")}</h2>
      <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 13 }}>
        {t("guidesNote")}{" "}
        <Link href="/helpdesk">Helpdesk</Link>.
      </p>
      {visibleModules.length === 0 ? ( // ux-001-ok: visibleModules is derived from static module config, not a fetch
        <EmptyState
          title={t("emptyTitle")}
          message={t("emptyMessage")}
          action={
            <Link href="/helpdesk" className="btn primary">
              {t("openHelpdesk")}
            </Link>
          }
        />
      ) : (
        <div className="grid g-3">
          {visibleModules.map((m) => (
            <Link
              key={m.slug}
              href={`/help/${m.slug}`}
              className="mtile"
              style={{ textDecoration: "none", color: "inherit", display: "block" }}
            >
              <div className="ic brand" aria-hidden="true">
                {m.icon}
              </div>
              <h3 className="v">{m.title}</h3>
              <div className="l">{m.summary}</div>
            </Link>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, margin: "28px 0 12px" }}>{t("wordsHeading")}</h2>
      <Card padding>
        <p style={{ marginTop: 0, color: "var(--mut)", fontSize: 13.5 }}>
          {t("wordsIntro")}
        </p>
        <GlossaryList rows={glossaryRows} />
      </Card>

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        Still stuck? Open <Link href="/setup">Getting Started</Link> to walk through setup again,
        or raise a ticket from <Link href="/helpdesk">Helpdesk</Link>.
      </p>
    </section>
  );
}
