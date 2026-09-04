import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid } from "@/app/_components/ds";
import {
  MUNICIPAL_SERVICE_CATALOG,
  SEC5_SERVICE_COUNT,
  officerApplicationsHref,
} from "./_data/services";

export const dynamic = "force-dynamic";

export default function MunicipalHubPage() {
  const sec5 = MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5);
  const reference = MUNICIPAL_SERVICE_CATALOG.filter((s) => !s.sec5);

  return (
    <>
      <PageHeader
        title="Municipal Services"
        subtitle={`Officer consoles and citizen entry points for BRD Section 5 — ${SEC5_SERVICE_COUNT} Sec5 services plus shop reference.`}
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eef2ff" label="Sec5 services" value={SEC5_SERVICE_COUNT} />
        <StatCard icon="📋" iconBg="#ecfdf5" label="Officer lists" value={MUNICIPAL_SERVICE_CATALOG.length} />
        <StatCard icon="🪪" iconBg="#fff7ed" label="Citizen apply links" value={MUNICIPAL_SERVICE_CATALOG.length} />
      </StatGrid>

      <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink2)", marginBottom: 10 }}>
            Section 5 services
          </h2>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {sec5.map((svc) => (
              <Link key={svc.serviceKey} href={`/municipal/${svc.serviceKey}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card padding>
                  <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>
                    {svc.icon}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{svc.label}</h3>
                  <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 10 }}>{svc.description}</p>
                  <div className="lnk" style={{ color: "var(--primary-d)", fontWeight: 650, fontSize: 13 }}>
                    Open officer console →
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {reference.length > 0 ? (
          <section>
            <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink2)", marginBottom: 10 }}>
              Reference template
            </h2>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {reference.map((svc) => (
                <Link key={svc.serviceKey} href={`/municipal/${svc.serviceKey}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <Card padding>
                    <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>
                      {svc.icon}
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{svc.label}</h3>
                    <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>{svc.description}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <Card title="Quick links" padding>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8 }}>
            {sec5.slice(0, 6).map((svc) => (
              <li key={svc.serviceKey}>
                <Link href={officerApplicationsHref(svc.serviceKey)}>{svc.label}</Link>
                {svc.citizenServiceKey ? (
                  <>
                    {" · "}
                    <Link href={`/citizen/services/${svc.citizenServiceKey}`}>Citizen portal</Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
