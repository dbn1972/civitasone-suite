import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { fetchApplication } from "./fetchApplication";
import { StageTimeline } from "./StageTimeline";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";

/** Small label text with >= 4.5:1 contrast on white (the old #94a3b8 was ~2.6:1). */
const MUTED = "#5b6b80";

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("careersPortalApplication");
  const token = cookies().get("cand_token")?.value;
  if (!token) redirect("/careers/portal/login");

  const result = await fetchApplication(token, params.id, { gateway: GATEWAY, fallbackTenantId: TENANT_ID });
  // GAP-...-APPLICATION-DETAIL-03: only a real 404 is "not found". An expired/invalid session goes
  // back to sign-in; an outage gets a retry card instead of a misleading 404.
  if (result.kind === "notfound") notFound();
  if (result.kind === "unauthorized") redirect("/careers/portal/login?expired=1");
  if (result.kind === "error") {
    return (
      <main style={{ minHeight: "100vh", background: "#f0f4f8", padding: "48px 16px" }}>
        <div role="alert" style={{ maxWidth: 480, margin: "0 auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px", color: "#0f172a" }}>{t("loadErrorTitle")}</h1>
          <p style={{ fontSize: 14, color: "#334155", margin: "0 0 16px" }}>{t("loadErrorBody")}</p>
          <Link href={`/careers/portal/application/${encodeURIComponent(params.id)}`} style={{ display: "inline-block", padding: "10px 20px", borderRadius: 8, background: "#154089", color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
            {t("retry")}
          </Link>
          <div style={{ marginTop: 14 }}>
            <Link href="/careers/portal" style={{ color: "#154089", fontSize: 14 }}>{t("backToList")}</Link>
          </div>
        </div>
      </main>
    );
  }
  const app_ = result.app;
  const { job, timeline, applicationNo } = app_;
  // closesAt is a bare calendar date: the vacancy accepts applications through the end of that day (IST).
  const closed = job?.closesAt ? job.closesAt.slice(0, 10) < todayIST() : false;

  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ background: "#154089", padding: "14px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/careers/portal" style={{ color: "#bfdbfe", fontSize: 13, textDecoration: "none" }}>{t("backToList")}</Link>
          <form method="POST" action="/api/careers/auth/logout" style={{ margin: 0 }}>
            <button type="submit" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#bfdbfe", fontSize: 13 }}>{t("signOut")}</button>
          </form>
        </div>
        <h1 style={{ color: "#fff", fontSize: 17, fontWeight: 700, margin: "6px 0 2px" }}>
          {job?.title ?? t("fallbackTitle")}
        </h1>
        <p style={{ color: "#93c5fd", fontSize: 13, margin: 0 }}>
          {[job?.refNo, job?.location].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px 16px", display: "grid", gap: 16 }}>
        {/* Application number */}
        <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED }}>{t("applicationNumber")}</div>
              <div style={{ fontSize: 17, fontWeight: 900, fontFamily: "monospace", color: "#154089", letterSpacing: "0.1em", marginTop: 2 }}>
                {applicationNo ?? app_.id.slice(0, 8).toUpperCase()}
              </div>
            </div>
            <div style={{ textAlign: "end" }}>
              <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("appliedOn")}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginTop: 2 }}>
                {formatIndianDate(app_.appliedAt)}
              </div>
            </div>
          </div>
        </div>

        {app_.outcome && (
          <div role="status" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", fontSize: 14, color: "#7f1d1d", fontWeight: 600 }}>
            {app_.outcome.message}
          </div>
        )}

        {/* Stage Rail */}
        <section aria-labelledby="journey-heading" style={{ background: "#fff", borderRadius: 10, padding: "16px 16px 20px", border: "1px solid #e2e8f0" }}>
          <h2 id="journey-heading" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, margin: "0 0 16px" }}>
            {t("journey")}
          </h2>
          <StageTimeline
            timeline={timeline}
            labels={{
              completed: t("stateCompleted"),
              current: t("stateCurrent"),
              upcoming: t("stateUpcoming"),
              ended: t("stateEnded"),
              inProgress: t("inProgress"),
              venue: t("interviewVenue"),
              joinLink: t("interviewJoinLink"),
              minutes: (n) => t("minutes", { count: n }),
              mode: (m) => (m === "video" || m === "in_person" || m === "telephonic" || m === "phone" ? t(`mode_${m === "phone" ? "telephonic" : m}`) : m),
            }}
          />
        </section>

        {/* Job info */}
        {job && (
          <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, margin: "0 0 10px" }}>{t("vacancyDetails")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {job.payRange && <InfoItem label={t("pay")} value={job.payRange} />}
              {job.vacancies > 0 && <InfoItem label={t("posts")} value={String(job.vacancies)} />}
              {job.location && <InfoItem label={t("location")} value={job.location} />}
              {job.closesAt && <InfoItem label={closed ? t("closedOn") : t("applicationsClose")} value={formatIndianDate(job.closesAt)} />}
            </div>
          </div>
        )}

        <Link href="/careers" style={{ display: "block", textAlign: "center", color: "#154089", fontSize: 14, fontWeight: 600 }}>
          {t("browseMore")}
        </Link>
      </div>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#334155", marginTop: 2 }}>{value}</div>
    </div>
  );
}
