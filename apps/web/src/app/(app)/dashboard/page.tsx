import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader, EmptyState, StatIcon } from "../../_components/ds";
import { RoleCommandCenter } from "./RoleCommandCenter";
import { FirstRunTour } from "./FirstRunTour";
import { ActivationTracker } from "../../_components/ActivationTracker";
import { getSessionRoles, hasRoleFamily } from "@/lib/auth/roleGuard";
import { MODULE_REGISTRY } from "@/app/_data/moduleRegistry";
import { getTranslations } from "next-intl/server";

export function visibleModules(roles: string[]) {
  if (roles.some((r) => r === "super_admin")) return MODULE_REGISTRY;
  // GAP-DASHBOARD-HOME-2-02: match on role FAMILY (exact or delimiter-prefixed),
  // not substring, so e.g. "chr_manager" no longer matches the "hr" family.
  // ux-001-ok: `m.roles` is a hardcoded property of the static MODULE_REGISTRY,
  // not fetched data — no loader/source in this path.
  return MODULE_REGISTRY.filter(
    (m) => m.roles.length === 0 || m.roles.some((family) => hasRoleFamily(roles, family)),
  );
}

export default async function DashboardPage() {
  const t = await getTranslations("home");
  const roles = getSessionRoles();
  // GAP-DASHBOARD-HOME-2-04: roles === [] means the session cookie was missing
  // or could not be decoded (getSessionRoles returns [] in both cases), NOT
  // "signed in with no modules". Treat it as a session-read failure and point
  // the user back to sign-in rather than showing an access-request message.
  const sessionUnreadable = roles.length === 0;
  const modules = sessionUnreadable ? [] : visibleModules(roles);

  return (
    <>
      <FirstRunTour />
      <ActivationTracker steps={["signin"]} />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<Link href="/workflow" className="btn primary">{t("myApprovals")}</Link>}
      />
      <Link
        href="/setup"
        aria-label={t("setupBannerTitle")}
        style={{ textDecoration: "none", display: "block", marginBottom: 18 }}
      >
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            background: "var(--primary-soft)",
            border: "1px solid var(--goodbd)",
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 22 }}>🚀</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("setupBannerTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--ink2)" }}>{t("setupBannerDesc")}</div>
          </div>
          {/*
            An icon, not a "→" text glyph: axe's color-contrast rule cannot
            reliably measure contrast for decorative Unicode arrow characters
            and treats that as an undecided, blocking result (same pattern as
            PageHeader.tsx's back arrow). An SVG icon isn't subject to that
            text-contrast heuristic.
          */}
          <ArrowRight aria-hidden="true" size={14} style={{ color: "var(--primary-d)" }} />
        </div>
      </Link>
      <RoleCommandCenter />
      <section aria-labelledby="dash-modules-h">
        <div className="card-h" style={{ marginBottom: 12 }}>
          <h2 id="dash-modules-h" style={{ margin: 0, fontSize: 15 }}>{t("yourModules")}</h2>
        </div>
        {sessionUnreadable ? ( // GAP-DASHBOARD-HOME-2-04: roles===[] is a session-read failure (missing/undecodable cookie), not "no modules"
          <div className="card">
            <div className="pad">
              <EmptyState
                icon="🔐"
                title={t("sessionUnreadable")}
                message={t("sessionUnreadableMsg")}
                action={<Link href="/auth/login" className="btn primary">{t("signInAgain")}</Link>}
              />
            </div>
          </div>
        ) : modules.length === 0 ? ( // ux-001-ok: `modules` is a synchronous filter of the static MODULE_REGISTRY against decoded session roles (a local JWT-cookie decode, not a network fetch) -- with a readable session, zero matches means the user's roles genuinely grant no module, never a fetch failure
          <div className="card">
            <div className="pad">
              <EmptyState
                icon="🧭"
                title={t("noModules")}
                message={t("noModulesMsg")}
              />
            </div>
          </div>
        ) : (
          <nav aria-label={t("yourModules")} className="grid g-4">
            {modules.map(({ icon, label, href, desc, bg }) => (
              <Link key={href} href={href} aria-label={label} style={{ textDecoration: "none", display: "block" }}>
                <div className="stat" style={{ cursor: "pointer", height: "100%" }}>
                  <div className="top">
                    <div />
                    <div className="ic" style={{ background: bg }} aria-hidden="true">
                      <StatIcon icon={icon} />
                    </div>
                  </div>
                  <div className="lab">{desc}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6, letterSpacing: "-0.3px", color: "var(--ink)" }}>
                    {label}
                  </div>
                </div>
              </Link>
            ))}
          </nav>
        )}
      </section>
    </>
  );
}
