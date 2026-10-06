import { getTranslations } from "next-intl/server";
import { ModuleHub } from "../../_components/ModuleHub";
import { THEME_ADMIN_ROLES } from "@/lib/auth/roleGuard";

export default async function Page() {
  const t = await getTranslations("themes");
  return (
    <ModuleHub
      title={t("title")}
      description={t("description")}
      help="themes"
      links={[
        // GAP-THEMES-HOME-02 / GAP-THEMES-BRANDING-02 (decision recorded for
        // HUMAN REVIEW): the four read/edit branding surfaces are kept but
        // relabelled by TASK + EFFECT, and ordered editor-first. Edit controls
        // (edit brand, publish tokens) are hidden from non-admins via `roles`
        // (the themes layout + theme-service remain the real gate); the two
        // read-only list routes are explicitly marked "read-only".
        { href: "/settings/branding", label: t("editBrandLabel"), note: t("editBrandNote"), roles: THEME_ADMIN_ROLES },
        { href: "/themes/tokens", label: t("tokensLabel"), note: t("tokensNote"), roles: THEME_ADMIN_ROLES },
        { href: "/themes/templates", label: t("templatesLabel"), note: t("templatesNote") },
        { href: "/themes/branding", label: t("brandingLabel"), note: t("brandingNote") },
        { href: "/themes/brand", label: t("brandLabel"), note: t("brandNote") },
      ]}
    />
  );
}
