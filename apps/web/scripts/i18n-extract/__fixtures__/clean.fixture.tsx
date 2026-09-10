// Fixture: everything user-facing is externalized via next-intl — the
// scanner must report zero findings for this file.
import { getTranslations } from "next-intl/server";

export default async function CleanExample() {
  const t = await getTranslations("example");
  return (
    <div className="wrapper" data-testid="clean-example">
      <h1>{t("title")}</h1>
      <button title={t("submitTitle")} aria-label={t("submitTitle")}>
        {t("submit")}
      </button>
      <input placeholder={t("namePlaceholder")} />
      <p>{t("noRecords")}</p>
      <img src="/icons/logo.svg" alt="" />
    </div>
  );
}
