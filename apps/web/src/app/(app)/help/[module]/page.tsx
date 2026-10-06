import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, EmptyState } from "../../../_components/ds";
import { HELP_MODULES, getHelpModule, defineTerm } from "@/lib/helpContent";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";

export function generateStaticParams() {
  return HELP_MODULES.map((m) => ({ module: m.slug }));
}

export function generateMetadata({ params }: { params: { module: string } }) {
  const mod = getHelpModule(params.module);
  return { title: mod ? `Help — ${mod.title}` : "Help" };
}

/**
 * Per-module help guide. Answers "what is this for", "how do I do the common
 * jobs", and "what do these words mean" — all in everyday language.
 *
 * GAP-HELP-MODULE-03: the guide is now gated to the tenant's enabled modules,
 * the same policy as the hub, so a guide for a module the office has turned off
 * is not served by direct URL. (This makes the route dynamic, overriding
 * generateStaticParams — kept so a static export of the common case still
 * works, with the enablement check applied at request time.) We deliberately do
 * NOT pass session roles into isModuleEnabled here: no caller (hub, ModuleGate,
 * setup wizard) passes roles today, so the hub and this page agree, and wiring
 * the admin bypass in one place only would let admins reach guides ModuleGate
 * then blocks (see GAP-HELP-HOME-03 decision).
 *
 * GAP-HELP-MODULE-04: the module emoji is rendered in an aria-hidden span and
 * the h1 title is the plain module name, so a screen reader announces "Grants",
 * not "🎁 Grants".
 */
export default async function HelpModulePage({ params }: { params: { module: string } }) {
  const mod = getHelpModule(params.module);
  if (!mod) notFound();

  const enabled = await getEnabledModules();
  if (!isModuleEnabled(enabled, mod.moduleKey)) {
    return (
      <section className="page-main wrap" aria-labelledby="page-heading">
        <p style={{ margin: "0 0 6px", fontSize: 13 }}>
          <Link href="/help">← Help Centre</Link>
        </p>
        <h1 id="page-heading" className="sr-only">
          {mod.title}
        </h1>
        <EmptyState
          title="This module is not enabled for your office"
          message="Ask your office administrator to turn it on, or go back to the Help Centre for the guides you can use."
          action={
            <Link href="/help" className="btn primary">
              Back to Help Centre
            </Link>
          }
        />
      </section>
    );
  }

  const terms = mod.terms
    .map((t) => ({ term: t, definition: defineTerm(t) }))
    .filter((t) => t.definition);

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <p style={{ margin: "0 0 6px", fontSize: 13 }}>
        <Link href="/help">← Help Centre</Link>
      </p>
      <PageHeader
        title={
          <>
            <span aria-hidden="true" style={{ marginInlineEnd: 8 }}>
              {mod.icon}
            </span>
            {mod.title}
          </>
        }
        subtitle={mod.summary}
      />

      <div style={{ marginBottom: 18 }}>
        <Link href={mod.href} className="btn primary">
          Open {mod.title}
        </Link>
      </div>

      <h2 style={{ fontSize: 16, margin: "8px 0 12px" }}>How do I…?</h2>
      <div className="grid g-2">
        {mod.tasks.map((task) => (
          <Card key={task.title} padding>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{task.title}</h3>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              {task.steps.map((step, i) => {
                const text = typeof step === "string" ? step : step.text;
                const href = typeof step === "string" ? undefined : step.href;
                return (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {href ? <Link href={href}>{text}</Link> : text}
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}
      </div>

      {terms.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: "28px 0 12px" }}>Words explained</h2>
          <Card padding>
            <dl style={{ margin: 0, display: "grid", gap: 12 }}>
              {terms.map(({ term, definition }) => (
                <div key={term}>
                  <dt style={{ fontWeight: 700, fontSize: 14 }}>{term}</dt>
                  <dd style={{ margin: "2px 0 0", color: "var(--ink)", lineHeight: 1.5 }}>
                    {definition}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        Need a different topic? Go back to the <Link href="/help">Help Centre</Link>.
      </p>
    </section>
  );
}
