import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { CAREERS_MUTED } from "./theme";
import type { CareersOrg } from "./organisation";

export type CareersHeaderProps = { org: CareersOrg; name: string; emblemAlt: string };

/**
 * Resolves the translated pieces the header needs. The header itself is synchronous (so it renders inside any
 * tree); the page awaits this once and spreads the result: `<CareersHeader {...await careersHeaderProps(org)} />`.
 */
export async function careersHeaderProps(org: CareersOrg): Promise<CareersHeaderProps> {
  const t = await getTranslations("careersCommon");
  const name = org.organisationName ?? t("fallbackName");
  return { org, name, emblemAlt: t("emblemAlt", { name }) };
}

/**
 * Shared header for every public careers page (home, vacancy, candidate sign-in and portal):
 * the office's own name, department and emblem, plus the language switcher. A tenant that has not
 * configured an identity gets a neutral "Careers" line -- never a sovereign / department claim.
 */
export function CareersHeader({ org, name, emblemAlt }: CareersHeaderProps) {
  return (
    <div
      data-testid="careers-org-header"
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 24px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {org.emblemUrl && (
          // a plain img on purpose: the emblem is office-configured and its host is not known at build time
          <img src={org.emblemUrl} alt={emblemAlt} width={44} height={44} style={{ objectFit: "contain" }} />
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", lineHeight: 1.25 }}>{name}</div>
          {org.departmentName && <div style={{ fontSize: 13, color: CAREERS_MUTED }}>{org.departmentName}</div>}
        </div>
      </div>
      <LanguageSwitcher />
    </div>
  );
}
