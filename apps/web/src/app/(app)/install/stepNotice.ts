/**
 * UAT b15 item 4: what a step errorMessage means for the person reading the installer.
 *
 * `no_drafts_imported` comes from citizen-service (packs/consumer.ts, packDomainActivate): the Stage 3 Domain Pack
 * activation finished but imported zero service drafts, because the domain pack lists no service templates for this
 * office or none of its service packs is available to the tenant. Nothing failed and nothing was written, so it is an
 * empty result and gets a notice with the next step. Any other errorMessage is a real failure and stays an error.
 * Plain module (no "use client"): read by the Server Component /install page and the client steps log.
 */
export const NOTHING_IMPORTED_REASON = "no_drafts_imported";

export const NOTHING_IMPORTED_COPY = {
  title: "No service templates were imported",
  message:
    "The domain pack was activated, but it has no service templates available for this office yet, so nothing was added. Check the Domain Packs catalogue for the templates it offers, then run the activation again.",
  linkLabel: "Open Domain Packs",
  href: "/install/domain-packs",
} as const;

export type StepNotice = { kind: "nothingImported" } | { kind: "error"; text: string };

export function stepNotice(errorMessage: string | null | undefined): StepNotice | null {
  const text = (errorMessage ?? "").trim();
  if (!text) return null;
  if (text === NOTHING_IMPORTED_REASON) return { kind: "nothingImported" };
  return { kind: "error", text };
}
