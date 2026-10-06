import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid } from "@/app/_components/ds";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";
import {
  MUNICIPAL_SERVICE_CATALOG,
  officerApplicationsHref,
} from "./_data/services";

export const dynamic = "force-dynamic";

export default async function MunicipalHubPage() {
  // GAP-MUNICIPAL-HOME-02: only surface consoles for modules the tenant has
  // enabled, using the SAME source of truth as the per-service ModuleGate
  // (lib/moduleVisibility). An unknown enablement list (load error / legacy
  // tenant) falls back to showing all — this is a UX convenience only; the
  // ModuleGate layout and the server routes remain authoritative.
  const enabledModules = await getEnabledModules();
  const visible = MUNICIPAL_SERVICE_CATALOG.filter((s) => isModuleEnabled(enabledModules, s.moduleKey));

  const sec5 = visible.filter((s) => s.sec5);
  const reference = visible.filter((s) => !s.sec5);

  // GAP-MUNICIPAL-HOME-01: compute the three stat values from the visible list
  // so "Officer consoles" and "Citizen apply links" are no longer the same
  // number by construction — only services with a citizen-service manifest
  // contribute a citizen link.
  const sec5Count = sec5.length;
  const officerConsoleCount = visible.length;
  const citizenLinkCount = visible.filter((s) => s.citizenServiceKey).length;

  return (
    <>
      <PageHeader
        title="Municipal Services"
        subtitle="Officer consoles and citizen entry points for municipal services."
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eef2ff" label="Municipal services" value={sec5Count} />
        <StatCard icon="📋" iconBg="#ecfdf5" label="Officer consoles" value={officerConsoleCount} />
        <StatCard icon="🪪" iconBg="#fff7ed" label="Citizen apply links" value={citizenLinkCount} />
      </StatGrid>

      <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
        <section>
          <h2 id="municipal-services-heading" style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink2)", marginBottom: 10 }}>
            Municipal services
          </h2>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {sec5.map((svc) => (
              <Link key={svc.serviceKey} href={`/municipal/${svc.serviceKey}`} aria-label={svc.label} style={{ textDecoration: "none", color: "inherit" }}>
                <Card padding>
                  <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>
                    {svc.icon}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{svc.label}</h3>
                  <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5, marginBottom: 10 }}>{svc.description}</p>
                  <div className="lnk" style={{ color: "var(--primary-d)", fontWeight: 650, fontSize: 13 }} aria-hidden>
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
              Other services
            </h2>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {reference.map((svc) => (
                <Link key={svc.serviceKey} href={`/municipal/${svc.serviceKey}`} aria-label={svc.label} style={{ textDecoration: "none", color: "inherit" }}>
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
          {/* GAP-MUNICIPAL-HOME-04: list every municipal service rather than
              silently truncating to the first 6, so none are reachable only
              from the tile grid. */}
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13.5, lineHeight: 1.8 }}>
            {sec5.map((svc) => (
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
