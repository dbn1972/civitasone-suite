"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // GAP-HR-ADVANCES-07: the back label and area noun are translated (advances.*).
  const t = useTranslations("advances");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr"
      backLabel={t("backToHr")}
      area={t("errorArea")}
    />
  );
}
