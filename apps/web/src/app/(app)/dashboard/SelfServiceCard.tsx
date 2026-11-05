import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SELF_SERVICE_ITEMS, isNavItemVisible } from "@/lib/nav/navModel";

/**
 * UAT-P3 (S-02): an employee dashboard offered no route to leave, payslips,
 * attendance or the tax declaration ("Your modules" showed Reports, Knowledge,
 * Notifications only), so the most common employee tasks needed a typed URL.
 * This card lists the same self-service entries as the sidebar, filtered by
 * the same role gates (lib/nav/navModel.ts).
 */
export async function SelfServiceCard({
  roles,
  enabledModules = null,
}: {
  roles: readonly string[];
  /** Tenant module keys (null = unknown: show). A standalone tenant without hrms-* must not be offered ModuleGate-blocked links. */
  enabledModules?: readonly string[] | null;
}) {
  const items = SELF_SERVICE_ITEMS.filter((i) => isNavItemVisible(i, { roles, enabledModules }));
  if (items.length === 0) return null;
  const t = await getTranslations("appNav");
  return (
    <section aria-labelledby="dash-self-h" className="card" style={{ marginBottom: 18 }}>
      <div className="card-h">
        <h2 id="dash-self-h" style={{ margin: 0, fontSize: 16 }}>{t("selfServiceTitle")}</h2>
      </div>
      <div className="pad">
        <p style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: 14 }}>{t("selfServiceDesc")}</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {items.map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="btn">{t(`item.${i.id}`)}</Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
