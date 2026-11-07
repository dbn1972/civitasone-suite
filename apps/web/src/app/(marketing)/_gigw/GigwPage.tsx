/**
 * Shared layout for the GIGW 3.0 public pages (UAT gigw-content): one h1,
 * an optional intro, one <section> per h2, and the GIGW "Last reviewed" note
 * at the end of every page.
 */
import type { ReactNode } from "react";

export interface GigwSection {
  id: string;
  heading: string;
  body: ReactNode;
}

export function GigwPage({
  title,
  intro,
  sections,
  reviewed,
}: {
  title: string;
  intro?: string;
  sections: GigwSection[];
  /** "Last reviewed: <date>" (GIGW review date), already translated. */
  reviewed: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {intro ? <p className="mt-4 text-lg text-gray-700">{intro}</p> : null}
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`gigw-${s.id}`} className="mt-8">
          <h2 id={`gigw-${s.id}`} className="text-xl font-semibold text-gray-900">
            {s.heading}
          </h2>
          {s.body}
        </section>
      ))}
      <p data-gigw-reviewed="" className="mt-12 border-t border-gray-200 pt-4 text-sm text-gray-600">
        {reviewed}
      </p>
    </div>
  );
}
