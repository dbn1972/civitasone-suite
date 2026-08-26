"use client";

import { usePathname } from "next/navigation";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Error boundaries don't receive route params, only the current URL. This
  // page is always at /crm/contacts/{id}/edit, so strip the trailing /edit
  // to link back to the contact instead of the literal, unresolved
  // "/crm/contacts/[id]" placeholder.
  const pathname = usePathname();
  const backHref = pathname?.replace(/\/edit\/?$/, "") || "/crm/contacts";

  return (
    <RouteError
      error={error}
      reset={reset}
      backHref={backHref}
      backLabel="Back"
      area="contact"
    />
  );
}
