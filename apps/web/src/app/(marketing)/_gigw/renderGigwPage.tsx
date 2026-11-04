import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { formatIndianDate } from "@/lib/formatters";
import { contentLastUpdated } from "@/lib/gigw/siteIdentity";
import {
  GIGW_CONFIG_KEYS,
  GIGW_NAME_DEFAULTS,
  displayEmail,
  isEmailField,
  readGigwConfig,
  type GigwConfig,
  type GigwConfigField,
} from "@/lib/gigw/departmentConfig";
import { GigwPage, type GigwSection } from "./GigwPage";
import { GIGW_PAGE_SPECS, SCREEN_READERS, type GigwBlock, type GigwSlug } from "./gigwContent";

// UAT gigw-content (GIGW 3.0): shared renderer for every GIGW public page
// (spec in gigwContent.ts, identity and contacts from departmentConfig.ts).
type T = (key: string, values?: Record<string, string>) => string;

const FIELD_LABEL: Record<GigwConfigField, string> = {
  department: "fieldDepartment",
  wimDesignation: "fieldWimDesignation",
  wimEmail: "fieldEmail",
  wimPhone: "fieldPhone",
  address: "fieldAddress",
  helpdeskEmail: "fieldEmail",
  helpdeskPhone: "fieldPhone",
  helpdeskHours: "fieldHours",
  pioContact: "fieldPio",
  reviewedAt: "lastReviewed",
};

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

interface Ctx { t: T; cfg: GigwConfig; vars: Record<string, string> }

function fieldValue(field: GigwConfigField, { t, cfg }: Ctx): ReactNode {
  const value = cfg[field];
  if (value) return isEmailField(field) ? displayEmail(value) : value;
  const fallback = GIGW_NAME_DEFAULTS[field];
  if (fallback) return <span data-gigw-default={GIGW_CONFIG_KEYS[field]}>{t(fallback)}</span>;
  return <span data-gigw-unset={GIGW_CONFIG_KEYS[field]}>{t("toBeConfigured")}</span>;
}

const P = "mt-3 text-gray-700";
const LIST = "mt-3 space-y-1 ps-6 text-gray-700";
const LINK = "text-blue-700 underline hover:text-blue-900";

function renderBlocks(blocks: GigwBlock[], ctx: Ctx, prefix: string): ReactNode[] {
  const { t, vars } = ctx;
  return blocks.map((b, i) => {
    const key = `${prefix}-${i}`;
    if ("p" in b) return <p key={key} className={P}>{t(b.p, vars)}</p>;
    if ("ul" in b) return <ul key={key} className={`${LIST} list-disc`}>{b.ul.map((k) => <li key={k}>{t(k, vars)}</li>)}</ul>;
    if ("ol" in b) return <ol key={key} className={`${LIST} list-decimal`}>{b.ol.map((k) => <li key={k}>{t(k, vars)}</li>)}</ol>;
    if ("links" in b) {
      return (
        <ul key={key} className={`${LIST} list-disc`}>
          {b.links.map((l) => (
            <li key={l.href}><Link href={l.href} className={LINK}>{t(l.label)}</Link></li>
          ))}
        </ul>
      );
    }
    if ("contact" in b) {
      return (
        <dl key={key} className="mt-3 space-y-2 text-gray-700">
          {b.contact.map((f) => (
            <div key={f} data-gigw-field={f} className="sm:flex sm:gap-3">
              <dt className="font-semibold text-gray-900 sm:w-56 sm:shrink-0">{t(FIELD_LABEL[f])}</dt>
              <dd className="m-0 break-words">{fieldValue(f, ctx)}</dd>
            </div>
          ))}
        </dl>
      );
    }
    if ("readers" in b) {
      return (
        <table key={key} className="mt-4 w-full border-collapse text-start text-sm text-gray-900">
          <caption className="sr-only">{t("srTableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-gray-300 py-2 pe-4 text-start">{t("srColName")}</th>
              <th scope="col" className="border-b border-gray-300 py-2 pe-4 text-start">{t("srColDescription")}</th>
              <th scope="col" className="border-b border-gray-300 py-2 text-start">{t("srColType")}</th>
            </tr>
          </thead>
          <tbody>
            {SCREEN_READERS.map((r) => (
              <tr key={r.id}>
                <th scope="row" lang="en" className="border-b border-gray-200 py-2 pe-4 text-start align-top font-medium">{r.name}</th>
                <td className="border-b border-gray-200 py-2 pe-4 align-top text-gray-700">{t(r.description)}</td>
                <td className="border-b border-gray-200 py-2 align-top text-gray-700">{t(r.kind)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return (
      <div key={key}>
        <h3 className="mt-5 text-lg font-semibold text-gray-900">{t(b.h3)}</h3>
        {renderBlocks(b.blocks, ctx, key)}
      </div>
    );
  });
}

/** "Last reviewed": the department-set review date, else the build date. */
function reviewedLabel(t: T, cfg: GigwConfig): string {
  const date = contentLastUpdated(cfg.reviewedAt, process.env.NEXT_PUBLIC_BUILD_TIME);
  const shown = date ? formatIndianDate(date) : "—";
  return shown !== "—" ? t("lastReviewed", { date: shown }) : t("lastReviewedPending");
}

export async function renderGigwPage(slug: GigwSlug) {
  const t = await gigwT();
  const cfg = readGigwConfig();
  const ctx: Ctx = { t, cfg, vars: { department: cfg.department ?? t("defaultDepartment") } };
  const spec = GIGW_PAGE_SPECS[slug];
  const sections: GigwSection[] = spec.sections.map((s) => ({
    id: s.id,
    heading: t(s.heading),
    body: <>{renderBlocks(s.blocks, ctx, s.id)}</>,
  }));
  return (
    <GigwPage
      title={t(spec.title)}
      intro={spec.intro ? t(spec.intro, ctx.vars) : undefined}
      sections={sections}
      reviewed={reviewedLabel(t, cfg)}
    />
  );
}
