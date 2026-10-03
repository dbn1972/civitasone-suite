import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ApplyForm } from "./ApplyForm";
import { getVacancy, isClosed } from "./vacancy";
import { CAREERS_MUTED, CAREERS_PRIMARY } from "../theme";
import { CareersHeader, careersHeaderProps } from "../CareersHeader";
import { getCareersOrg } from "../organisation";

// Colours only: the labels are translated (careersDetail.type_*).
const TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  regular:       { color: "#1e40af", bg: "#dbeafe" },
  internship:    { color: "#7c2d12", bg: "#fed7aa" },
  apprenticeship:{ color: "#166534", bg: "#bbf7d0" },
  volunteership: { color: "#0e7490", bg: "#cffafe" },
  contractual:   { color: "#6b21a8", bg: "#e9d5ff" },
  deputation:    { color: "#475569", bg: "#e2e8f0" },
};

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const t = await getTranslations("careersDetail");
  const r = await getVacancy(params.id);
  return { title: r.status === "ok" ? t("metaTitle", { title: r.vacancy.title }) : t("metaFallback") };
}

export const dynamic = "force-dynamic";

export default async function VacancyPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("careersDetail");
  const result = await getVacancy(params.id);
  if (result.status === "notfound") notFound();
  const org = await getCareersOrg();

  if (result.status === "error") {
    return (
      <main style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <CareersHeader {...await careersHeaderProps(org)} />
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
          <Link href="/careers" style={{ fontSize: 13, color: CAREERS_PRIMARY, textDecoration: "none", display: "inline-block", marginBottom: 20 }}>
            ← {t("allOpenings")}
          </Link>
          <div role="alert" style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">⚠️</p>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>{t("errorTitle")}</h1>
            <p style={{ color: CAREERS_MUTED, fontSize: 15, margin: "0 0 16px" }}>{t("errorText")}</p>
            <Link href={`/careers/${encodeURIComponent(params.id)}`} style={{ display: "inline-block", padding: "10px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              {t("tryAgain")}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const v = result.vacancy;
  const closed = isClosed(v);

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <CareersHeader {...await careersHeaderProps(org)} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
        <a href="/careers" style={{ fontSize: 13, color: CAREERS_PRIMARY, textDecoration: "none", display: "inline-block", marginBottom: 20 }}>
          ← {t("allOpenings")}
        </a>

        <article style={{ background: "#fff", borderRadius: 16, padding: "32px", border: "1px solid #e2e8f0" }}>
          {(() => {
            const style = TYPE_STYLES[v.vacancyType];
            const ti = { color: style?.color ?? CAREERS_PRIMARY, bg: style?.bg ?? "#eef2ff", label: style ? t(`type_${v.vacancyType}`) : v.vacancyType };
            return (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, color: ti.color, background: ti.bg }}>
                  {ti.label}
                </span>
                <span style={{ fontSize: 12, color: CAREERS_MUTED }}>{t("ref", { refNo: v.refNo })}</span>
              </div>
            );
          })()}

          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "0 0 16px", letterSpacing: "-0.3px" }}>
            {v.title}
          </h1>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
            {v.location && <InfoCard icon="📍" label={t("infoLocation")} value={v.location} />}
            {v.payRange && <InfoCard icon="💰" label={t("infoPay")} value={v.payRange} />}
            {v.vacancies > 0 && <InfoCard icon="👥" label={t("infoPositions")} value={String(v.vacancies)} />}
            {v.qualification && <InfoCard icon="🎓" label={t("infoQualification")} value={v.qualification} />}
            {v.closesAt && <InfoCard icon="📅" label={t("infoApplyBy")} value={new Date(v.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />}
          </div>

          {v.description && (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155", margin: "0 0 8px" }}>{t("aboutRole")}</h2>
              <p style={{ color: "#475569", lineHeight: 1.7, fontSize: 14.5, whiteSpace: "pre-wrap", margin: 0 }}>
                {v.description}
              </p>
            </div>
          )}

          {closed ? (
            <div role="status" style={{ padding: "16px 20px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>
              {v.closedReason ? t("closedWithReason", { reason: v.closedReason }) : t("closed")}
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: "0 0 16px", paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                {t("applyNow")}
              </h2>
              <ApplyForm jobOpeningId={v.id} vacancyType={v.vacancyType} />
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f8fafc", borderRadius: 10, border: "1px solid #f1f5f9" }}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: CAREERS_MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 14, color: "#0f172a", fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
}
