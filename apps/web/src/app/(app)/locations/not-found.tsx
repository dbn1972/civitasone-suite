import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/app/_components/ds";

export default async function LocationsNotFound() {
  const t = await getTranslations("locationsHub");
  return (
    <EmptyState
      title={t("notFoundTitle")}
      message={t("notFoundMessage")}
      action={
        <Link href="/locations" className="btn primary">
          {t("notFoundAction")}
        </Link>
      }
    />
  );
}
