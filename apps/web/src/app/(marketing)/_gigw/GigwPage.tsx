/**
 * UAT-P2-D3 (A11Y-19, GIGW 3.0 mandatory compliance pages): shared layout for
 * the public accessibility statement, screen-reader access and website
 * policies pages. DEFERRED-content: every section whose text the department
 * must supply renders a clearly marked "[Content pending]" placeholder with
 * data-deferred-content, never invented policy text.
 */
import type { ReactNode } from "react";

export interface GigwSection {
  id: string;
  heading: string;
  /** Real content, when it exists; otherwise the section is a marked placeholder. */
  body?: ReactNode;
}

export function GigwPage({
  title,
  intro,
  pendingNotice,
  pendingSection,
  sections,
  children,
}: {
  title: string;
  intro?: string;
  /** Page-level notice (pending content or standard wording); omitted for fully factual pages. */
  pendingNotice?: string;
  pendingSection: string;
  sections: GigwSection[];
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {intro ? <p className="mt-4 text-gray-700">{intro}</p> : null}
      {pendingNotice ? (
        <p role="note" data-deferred-content="page" className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {pendingNotice}
        </p>
      ) : null}
      {children}
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`gigw-${s.id}`} className="mt-8">
          <h2 id={`gigw-${s.id}`} className="text-xl font-semibold text-gray-900">
            {s.heading}
          </h2>
          {s.body ?? (
            <p data-deferred-content={s.id} className="mt-2 text-gray-700">
              {pendingSection}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
