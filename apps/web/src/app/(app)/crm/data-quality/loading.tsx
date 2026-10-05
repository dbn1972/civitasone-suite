import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div role="status" aria-live="polite" style={{ padding: 24, color: "var(--muted)" }}>
      {t("dataQuality")}
    </div>
  );
}
