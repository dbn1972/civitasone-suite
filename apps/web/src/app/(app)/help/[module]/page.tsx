import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card } from "../../../_components/ds";
import { HELP_MODULES, getHelpModule, defineTerm } from "@/lib/helpContent";

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
 */
export default function HelpModulePage({ params }: { params: { module: string } }) {
  const mod = getHelpModule(params.module);
  if (!mod) notFound();

  const terms = mod.terms
    .map((t) => ({ term: t, definition: defineTerm(t) }))
    .filter((t) => t.definition);

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <p style={{ margin: "0 0 6px", fontSize: 13 }}>
        <Link href="/help">← Help Centre</Link>
      </p>
      <PageHeader title={`${mod.icon} ${mod.title}`} subtitle={mod.summary} />

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
              {task.steps.map((step, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {step}
                </li>
              ))}
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
