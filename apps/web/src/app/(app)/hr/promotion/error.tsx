"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // UX-017: `backLabel`/`area` aren't in the UX-004 scanner's tracked-prop
  // allowlist (a known fleet-wide blind spot -- see tranche 4's commit
  // message), so this route boundary silently scored zero findings despite
  // real hardcoded text. Fixed here as this tranche's own touched instance,
  // same as tranche 4 fixed only its own 4 error.tsx files rather than the
  // other ~510 fleet-wide -- that broader fix stays its own tracked follow-up.
  const t = useTranslations("promotion");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr"
      backLabel={t("errorBackLabel")}
      area={t("errorArea")}
    />
  );
}
