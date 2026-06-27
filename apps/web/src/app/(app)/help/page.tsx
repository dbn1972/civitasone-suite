import Link from "next/link";
import { PageHeader, Card } from "../../_components/ds";
import { ReplayTourButton } from "./ReplayTourButton";
import { HELP_MODULES } from "@/lib/helpContent";
import { GLOSSARY } from "@/lib/glossary";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";

export const metadata = {
  title: "Help Centre",
};

/**
 * Help Centre hub — a plain-language home for "how do I…?" questions.
 * Lists a short guide for every module the office uses, plus a glossary of the
 * specialist words used across the system. Written for a first-time clerk with
 * no training. Module guides are filtered to the tenant's enabled modules
 * (R13.2); when enablement is unknown, all are shown.
 */
export default async function HelpPage() {
  const enabled = await getEnabledModules();
  const visibleModules = HELP_MODULES.filter((m) => isModuleEnabled(enabled, m.moduleKey));

  const glossaryEntries = Object.entries(GLOSSARY).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Help Centre"
        subtitle="Short, plain-language guides for every part of the system. Pick a topic, or look up a word you're unsure about."
        actions={<ReplayTourButton />}
      />

      <h2 style={{ fontSize: 16, margin: "8px 0 12px" }}>Guides by module</h2>
      <div className="grid g-3">
        {visibleModules.map((m) => (
          <Link
            key={m.slug}
            href={`/help/${m.slug}`}
            className="mtile"
            style={{ textDecoration: "none", color: "inherit", display: "block" }}
          >
            <div className="ic" style={{ background: "#eef2ff" }} aria-hidden="true">
              {m.icon}
            </div>
            <h3 className="v">{m.title}</h3>
            <div className="l">{m.summary}</div>
          </Link>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: "28px 0 12px" }}>Words explained</h2>
      <Card padding>
        <p style={{ marginTop: 0, color: "var(--mut)", fontSize: 13.5 }}>
          Government and accounting words you'll see around the system, in plain English.
        </p>
        <dl style={{ margin: 0, display: "grid", gap: 12 }}>
          {glossaryEntries.map(([term, definition]) => (
            <div key={term}>
              <dt style={{ fontWeight: 700, fontSize: 14 }}>{term}</dt>
              <dd style={{ margin: "2px 0 0", color: "var(--ink)", lineHeight: 1.5 }}>
                {definition}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        Still stuck? Open <Link href="/setup">Getting Started</Link> to walk through setup again,
        or raise a ticket from <Link href="/helpdesk">Helpdesk</Link>.
      </p>
    </section>
  );
}
