import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GigwPage, type GigwSection } from "./GigwPage";
import { GIGW_PAGE_SPECS, type GigwSlug } from "./gigwContent";

// UAT post-b14 (GIGW 3.0): shared renderer for the data-driven GIGW pages
// (gigwContent.ts). Department-specific sections are marked placeholders.
type T = (key: string) => string;

async function gigwT(): Promise<T> {
  return (await getTranslations("gigw")) as unknown as T;
}

export async function gigwMetadata(slug: GigwSlug, canonical?: string): Promise<Metadata> {
  const t = await gigwT();
  return {
    title: `${t(GIGW_PAGE_SPECS[slug].title)} | CivitasOne`,
    ...(canonical ? { alternates: { canonical } } : {}),
  };
}

export async function renderGigwPage(slug: GigwSlug) {
  const t = await gigwT();
  const spec = GIGW_PAGE_SPECS[slug];
  const sections: GigwSection[] = spec.sections.map((s) => ({
    id: s.id,
    heading: t(s.heading),
    body:
      s.paras || s.links ? (
        <>
          {(s.paras ?? []).map((p) => (
            <p key={p} className="mt-2 text-gray-700">{t(p)}</p>
          ))}
          {s.links ? (
            <ul className="mt-2 list-disc space-y-1 ps-6">
              {s.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-blue-700 underline hover:text-blue-900">{t(l.label)}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : undefined,
  }));
  return (
    <GigwPage
      title={t(spec.title)}
      intro={spec.intro ? t(spec.intro) : undefined}
      pendingNotice={spec.notice === "pending" ? t("pendingNotice") : spec.notice === "standard" ? t("standardNotice") : undefined}
      pendingSection={t("pendingDepartment")}
      sections={sections}
    />
  );
}
