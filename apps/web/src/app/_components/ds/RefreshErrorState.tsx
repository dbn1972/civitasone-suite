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
import { useRouter } from "next/navigation";
import { ErrorState } from "./ErrorState";
import type { HumanError } from "@/lib/messages";

export interface RefreshErrorStateProps {
  error: HumanError;
  onBack?: () => void;
  backHref?: string;
  helpHref?: string;
}

export function RefreshErrorState({ error, onBack, backHref, helpHref }: RefreshErrorStateProps) {
  const router = useRouter();
  return (
    <ErrorState
      error={error}
      onRetry={() => router.refresh()}
      onBack={onBack}
      backHref={backHref}
      helpHref={helpHref}
    />
  );
}
