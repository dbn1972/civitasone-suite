"use client";

import { RouteError } from "@/app/_components/RouteError";
import { useTranslations } from "next-intl";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tc = useTranslations("common");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/leave"
      backLabel={tc("backToLeave")}
      area="Leave Approvals"
    />
  );
}
