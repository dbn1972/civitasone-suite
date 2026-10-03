import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CAREERS_MUTED, CAREERS_PRIMARY, SR_ONLY } from "./theme";
import { CareersHeader, careersHeaderProps } from "./CareersHeader";
import { getCareersOrg } from "./organisation";
import { PAGE_SIZE, careersHref, matchesQuery, parsePage, sortByClosing } from "./vacancyList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("careersHome");
  const org = await getCareersOrg();
  return { title: t("metaTitle", { name: org.organisationName ?? t("metaFallbackName") }), description: t("metaDescription") };
}

export const dynamic = "force-dynamic";

type Vacancy = {
  id: string;
  title: string;
  refNo: string;
  vacancyType: string;
  location?: string;
  qualification?: string;
  payRange?: string;
  vacancies: number;
  description?: string;
  postedAt?: string;
  closesAt?: string;
};

// Colours only: the labels are translated (careersHome.type_*).
const TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  regular:       { color: "#1e40af", bg: "#dbeafe" },
  internship:    { color: "#7c2d12", bg: "#fed7aa" },
  apprenticeship:{ color: "#166534", bg: "#bbf7d0" },
  volunteership: { color: "#0e7490", bg: "#cffafe" },
  contractual:   { color: "#6b21a8", bg: "#e9d5ff" },
  deputation:    { color: "#475569", bg: "#e2e8f0" },
};

// Derived from TYPE_STYLES so a type that gets a badge always gets a chip
// (GAP-RECRUITMENT-CAREERS-HOME-01: contractual/deputation used to be missing).
const TYPE_KEYS = Object.keys(TYPE_STYLES);

// UX-013: this used to return `[]` on ANY failure (bad response or network
// error) with no signal preserved anywhere -- a real outage of the careers
// service rendered pixel-identical to "no openings right now" for every job
// seeker hitting this public, unauthenticated page.
async function getVacancies(): Promise<{ vacancies: Vacancy[]; errored: boolean }> {
  const base = (process.env.CIVITASONE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const tenantId = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
  try {
    const res = await fetch(`${base}/api/v1/careers/vacancies`, {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { vacancies: [], errored: true };
    const json = await res.json();
    return { vacancies: (json.data || json) as Vacancy[], errored: false };
  } catch {
    return { vacancies: [], errored: true };
  }
}

export default async function CareersPage({ searchParams }: { searchParams: { type?: string; q?: string; page?: string } }) {
  const t = await getTranslations("careersHome");
  const { vacancies: allVacancies, errored } = await getVacancies();
  const org = await getCareersOrg();
  const typeLabel = (key: string): string => (TYPE_KEYS.includes(key) ? t(`type_${key}`) : key);
  const TYPE_FILTER_OPTIONS = [{ value: "", label: t("allOpenings") }, ...TYPE_KEYS.map((value) => ({ value, label: typeLabel(value) }))];
  const activeType = searchParams.type ?? "";
  const query = (searchParams.q ?? "").trim();

  // Search narrows everything (chip counts included) so counts always equal the cards a chip shows.
  const searched = allVacancies.filter((v) => matchesQuery(v, query));
  const countFor = (type: string) => searched.filter((v) => v.vacancyType === type).length;
  const filtered = activeType ? searched.filter((v) => v.vacancyType === activeType) : searched;
  const sorted = sortByClosing(filtered);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = parsePage(searchParams.page, pageCount);
  const vacancies = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeTypeLabel = typeLabel(activeType);
  // Chips for types with no openings are hidden, except the active one (so the user can see where they are).
  const visibleChips = TYPE_FILTER_OPTIONS.filter((o) => !o.value || o.value === activeType || countFor(o.value) > 0);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 40%)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* The office's own identity (GAP-RECRUITMENT-CAREERS-HOME-02): name / department / emblem from its settings. */}
      <CareersHeader {...await careersHeaderProps(org)} />

      {/* Hero */}
      <header style={{ textAlign: "center", padding: "40px 24px 32px", maxWidth: 800, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", margin: "0 0 12px", letterSpacing: "-0.5px" }}>
          {t("heroTitle")}
        </h1>
        <p style={{ fontSize: 17, color: "#475569", lineHeight: 1.6, margin: 0, maxWidth: 600, marginInline: "auto" }}>
          {t("heroText")}
        </p>
      </header>

      {/* Search */}
      {!errored && allVacancies.length > 0 && (
        <form method="GET" action="/careers" role="search" aria-label={t("searchAria")} style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 16px", display: "flex", gap: 8 }}>
          {activeType && <input type="hidden" name="type" value={activeType} />}
          <label htmlFor="careers-search" style={SR_ONLY}>{t("searchLabel")}</label>
          <input
            id="careers-search" name="q" type="search" defaultValue={query} placeholder={t("searchPlaceholder")}
            style={{ flex: 1, padding: "10px 14px", fontSize: 14, border: "1px solid #cbd5e1", borderRadius: 9, color: "#0f172a", background: "#fff" }}
          />
          <button type="submit" style={{ padding: "10px 18px", fontSize: 14, fontWeight: 700, color: "#fff", background: CAREERS_PRIMARY, border: "none", borderRadius: 9, cursor: "pointer" }}>
            {t("searchButton")}
          </button>
        </form>
      )}

      {/* Type filter tabs */}
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="navigation" aria-label={t("filterByType")}>
          {visibleChips.map((opt) => {
            const isActive = activeType === opt.value;
            const count = opt.value ? countFor(opt.value) : 0;
            return (
              <a
                key={opt.value}
                href={careersHref({ type: opt.value, q: query })}
                style={{
                  padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, textDecoration: "none",
                  background: isActive ? CAREERS_PRIMARY : "#fff",
                  color: isActive ? "#fff" : "#475569",
                  border: `1px solid ${isActive ? CAREERS_PRIMARY : "#cbd5e1"}`,
                  transition: "all 0.15s",
                }}
                aria-current={isActive ? "page" : undefined}
              >
                {opt.label}
                {opt.value && count > 0 && (
                  <span style={{ marginInlineStart: 6, opacity: 0.8, fontSize: 11 }}>{count}</span>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* Vacancies */}
      <section style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 64px" }} aria-label={t("openPositions")}>
        {errored ? (
          <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">⚠️</p>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{t("errorTitle")}</h2>
            <p style={{ color: "#64748b", fontSize: 15, margin: "0 0 16px" }}>{t("errorText")}</p>
            <Link href="/careers" style={{ display: "inline-block", padding: "10px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              {t("tryAgain")}
            </Link>
          </div>
        ) : vacancies.length === 0 ? (
          // Distinguish "this filter/search matches nothing" (offer a way back) from "the tenant has nothing published".
          allVacancies.length > 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0" }}>
              <p style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">🔍</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>
                {query
                  ? (activeType ? t("noMatchQueryInType", { query, type: activeTypeLabel }) : t("noMatchQuery", { query }))
                  : t("noTypeOpenings", { type: activeTypeLabel })}
              </h2>
              <p style={{ color: "#64748b", fontSize: 15, margin: "0 0 16px" }}>{t("tryDifferent")}</p>
              <Link href="/careers" style={{ display: "inline-block", padding: "10px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
                {t("viewAll")}
              </Link>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0" }}>
              <p style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">📋</p>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{t("noneTitle")}</h2>
              <p style={{ color: "#64748b", fontSize: 15 }}>{t("noneText")}</p>
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {vacancies.map((v) => {
              const typeInfo = { ...(TYPE_STYLES[v.vacancyType] ?? TYPE_STYLES.regular!), label: typeLabel(TYPE_STYLES[v.vacancyType] ? v.vacancyType : "regular") };
              return (
                <Link
                  key={v.id}
                  href={`/careers/${v.id}`}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <article
                    style={{
                      background: "#fff", borderRadius: 14, padding: "24px 28px",
                      border: "1px solid #e2e8f0",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, color: typeInfo.color, background: typeInfo.bg }}>
                        {typeInfo.label}
                      </span>
                      {v.closesAt && (
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          <strong style={{ fontWeight: 700 }}>{t("applyBy")}</strong>{" "}
                          {new Date(v.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontSize: 19, fontWeight: 700, color: "#0f172a", margin: "0 0 8px", letterSpacing: "-0.2px" }}>
                      {v.title}
                    </h2>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, color: "#475569" }}>
                      {v.location && <MetaItem icon="📍" label={t("metaLocation")} value={v.location} />}
                      {v.payRange && <MetaItem icon="💰" label={t("metaPay")} value={v.payRange} />}
                      {v.vacancies > 1 && <MetaItem icon="👥" label={t("metaPositions")} value={t("positionsCount", { count: v.vacancies })} />}
                      {v.qualification && <MetaItem icon="🎓" label={t("metaQualification")} value={v.qualification} />}
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}

        {!errored && pageCount > 1 && (
          <nav aria-label={t("pagination")} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 24, fontSize: 14 }}>
            {page > 1 ? (
              <Link href={careersHref({ type: activeType, q: query, page: page - 1 })} rel="prev" style={{ color: CAREERS_PRIMARY, fontWeight: 700 }}>← {t("previous")}</Link>
            ) : <span style={{ color: CAREERS_MUTED }}>← {t("previous")}</span>}
            <span style={{ color: "#475569" }}>{t("pageOf", { page, pageCount })}</span>
            {page < pageCount ? (
              <Link href={careersHref({ type: activeType, q: query, page: page + 1 })} rel="next" style={{ color: CAREERS_PRIMARY, fontWeight: 700 }}>{t("next")} →</Link>
            ) : <span style={{ color: CAREERS_MUTED }}>{t("next")} →</span>}
          </nav>
        )}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid #e2e8f0", color: CAREERS_MUTED, fontSize: 13 }}>
        {t("footerEqual")}
        <div style={{ marginTop: 6, fontSize: 11 }}>{t("poweredBy")}</div>
      </footer>
    </main>
  );
}

/** Emoji are decorative: hidden from AT, with a visually-hidden label so it reads "Location: Bhubaneswar". */
function MetaItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <span>
      <span aria-hidden="true">{icon} </span>
      <span style={SR_ONLY}>{label}: </span>
      {value}
    </span>
  );
}
