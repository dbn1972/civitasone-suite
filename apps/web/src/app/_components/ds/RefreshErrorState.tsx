"use client";
/**
 * ErrorState wired for Server Component pages.
 *
 * A Server Component can't pass a real function to ErrorState's `onRetry`
 * (no client callbacks cross the RSC boundary), so callers were tempted to
 * either drop Retry entirely or fall back to the plainer EmptyState. This
 * thin client wrapper supplies a working `onRetry` via `router.refresh()`,
 * which re-runs the page's server-side data fetch in place (no full page
 * reload) — a genuine retry, not a fake button.
 *
 * Usage (from an async Server Component page.tsx):
 *   <RefreshErrorState
 *     error={{ what: "...", next: "...", actions: ["retry", "back", "help"] }}
 *     backHref="/meeting"
 *   />
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientLocale } from "@/lib/errorCatalogue";
import { ErrorState } from "./ErrorState";
import { humanErrorForStatus, type HumanError } from "@/lib/messages";

export interface RefreshErrorStateProps {
  error: HumanError;
  onBack?: () => void;
  backHref?: string;
  helpHref?: string;
  /** Support reference (correlation / request id), shown as a quiet secondary line. */
  reference?: string | null;
  /**
   * Where the failure came from. A Server Component renders `error` in English;
   * when this is given, the client re-resolves the standard copy in the user's
   * locale after hydration (so server and client markup match on first paint).
   */
  source?: { status?: number; code?: string | null; area?: string };
}

export function RefreshErrorState({ error, onBack, backHref, helpHref, reference, source }: RefreshErrorStateProps) {
  const router = useRouter();
  const [localised, setLocalised] = useState<HumanError | null>(null);
  useEffect(() => {
    if (source && getClientLocale() !== "en") {
      setLocalised({
        ...humanErrorForStatus(source.status, { area: source.area, intent: "load", code: source.code }),
        actions: error.actions,
      });
    }
  }, [source, error.actions]);
  return (
    <ErrorState
      error={localised ?? error}
      reference={reference}
      onRetry={() => router.refresh()}
      onBack={onBack}
      backHref={backHref}
      helpHref={helpHref}
    />
  );
}
