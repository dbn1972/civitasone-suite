import Link from "next/link";
import { PageHeader, Card, EmptyState } from "../../_components/ds";
import { ReplayTourButton } from "./ReplayTourButton";
import { GlossaryList } from "./GlossaryList";
import { HELP_MODULES } from "@/lib/helpContent";
import { collapseGlossary } from "@/lib/glossary";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";

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
  const enabled = await getEnabledModules();
  const visibleModules = HELP_MODULES.filter((m) => isModuleEnabled(enabled, m.moduleKey));

  const glossaryRows = collapseGlossary();

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Help Centre"
        subtitle="Short guides for the main modules, plus a plain-English glossary. Pick a topic, or look up a word you're unsure about."
        actions={<ReplayTourButton />}
      />

      <h2 style={{ fontSize: 16, margin: "8px 0 12px" }}>Guides by module</h2>
      <p style={{ margin: "0 0 12px", color: "var(--mut)", fontSize: 13 }}>
        Guides for other modules are being added. For anything not listed, raise a ticket from{" "}
        <Link href="/helpdesk">Helpdesk</Link>.
      </p>
      {visibleModules.length === 0 ? (
        <EmptyState
          title="No guides for your enabled modules"
          message="Your office has not turned on any modules with a guide yet. Raise a ticket from Helpdesk if you need help."
          action={
            <Link href="/helpdesk" className="btn primary">
              Open Helpdesk
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

      <h2 style={{ fontSize: 16, margin: "28px 0 12px" }}>Words explained</h2>
      <Card padding>
        <p style={{ marginTop: 0, color: "var(--mut)", fontSize: 13.5 }}>
          Government and accounting words you'll see around the system, in plain English.
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
