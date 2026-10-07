import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { chapters, chapterNumber } from "../_content/chapters";
import { MarkdownContent } from "../_content/markdown";
import { extractToc } from "../_content/toc";

interface Props {
  params: { slug: string };
}

export function generateStaticParams() {
  return chapters.map((ch) => ({ slug: ch.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const chapter = chapters.find((ch) => ch.slug === params.slug);
  if (!chapter) return {};
  // Suffix aligned with the rest of the marketing site ("— CivitasOne")
  // for a consistent product title convention (GAP-DOCS-SLUG-05).
  return {
    title: `${chapter.title} — CivitasOne`,
    description: chapter.description,
  };
}

/** Prefix a chapter title with its stable number when one is defined. */
function titleWithNumber(ch: { title: string; number?: number }): string {
  const n = chapterNumber(ch);
  return n === undefined ? ch.title : `${n}. ${ch.title}`;
}

export default function ChapterPage({ params }: Props) {
  const index = chapters.findIndex((ch) => ch.slug === params.slug);
  if (index === -1) notFound();

  const chapter = chapters[index]!;
  const prev = index > 0 ? chapters[index - 1]! : null;
  const next = index < chapters.length - 1 ? chapters[index + 1]! : null;
  const toc = extractToc(chapter.content);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10 xl:grid-cols-[240px_1fr_200px]">
        {/* Left sidebar (lg and up) */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            <Link
              href="/docs"
              className="mb-4 block text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
            >
              ← All Chapters
            </Link>
            {chapters.map((ch) => (
              <Link
                key={ch.slug}
                href={`/docs/${ch.slug}`}
                aria-current={ch.slug === params.slug ? "page" : undefined}
                className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                  ch.slug === params.slug
                    ? "bg-gray-100 font-medium text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                {ch.icon} {titleWithNumber(ch)}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0">
          {/* Mobile chapter navigation: a one-tap dropdown to any chapter (GAP-DOCS-SLUG-01) */}
          <details className="mb-6 rounded-lg border border-gray-200 lg:hidden">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-700">
              <span className="inline-flex w-full items-center justify-between">
                <span>Chapters</span>
                <span aria-hidden="true" className="text-gray-400">▾</span>
              </span>
            </summary>
            <nav aria-label="Chapters" className="border-t border-gray-200 p-2">
              {chapters.map((ch) => (
                <Link
                  key={ch.slug}
                  href={`/docs/${ch.slug}`}
                  aria-current={ch.slug === params.slug ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    ch.slug === params.slug
                      ? "bg-gray-100 font-medium text-gray-900"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {ch.icon} {titleWithNumber(ch)}
                </Link>
              ))}
            </nav>
          </details>

          {/* On this page (ToC) — collapsible below xl where the right rail is hidden */}
          {toc.length > 0 ? (
            <details className="mb-6 rounded-lg border border-gray-200 xl:hidden">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-700">
                On this page
              </summary>
              <nav aria-label="On this page" className="border-t border-gray-200 p-2">
                {toc.map((t) => (
                  <a
                    key={t.id}
                    href={`#${t.id}`}
                    className={`block rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 ${t.level === 3 ? "ps-6" : ""}`}
                  >
                    {t.text}
                  </a>
                ))}
              </nav>
            </details>
          ) : null}

          {/* Markdown content */}
          <article className="mx-auto max-w-[720px]" style={{ lineHeight: "1.75", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <MarkdownContent content={chapter.content} />
          </article>

          {/* Prev/Next navigation */}
          <nav className="mx-auto mt-16 flex max-w-[720px] items-center justify-between border-t border-gray-200 pt-8">
            {prev ? (
              <Link
                href={`/docs/${prev.slug}`}
                className="group flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
              >
                <span>←</span>
                <span>
                  <span className="block text-xs text-gray-400">Previous</span>
                  <span className="font-medium group-hover:underline">{prev.title}</span>
                </span>
              </Link>
            ) : <div />}
            {next ? (
              <Link
                href={`/docs/${next.slug}`}
                className="group flex items-center gap-2 text-end text-sm text-gray-500 hover:text-gray-900"
              >
                <span>
                  <span className="block text-xs text-gray-400">Next</span>
                  <span className="font-medium group-hover:underline">{next.title}</span>
                </span>
                <span>→</span>
              </Link>
            ) : <div />}
          </nav>
        </main>

        {/* Right rail: On this page ToC (xl and up) */}
        <aside className="hidden xl:block">
          {toc.length > 0 ? (
            <nav aria-label="On this page" className="sticky top-24 space-y-1">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                On this page
              </p>
              {toc.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className={`block rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 ${t.level === 3 ? "ps-4" : ""}`}
                >
                  {t.text}
                </a>
              ))}
            </nav>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
