import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

/**
 * GAP-ASSETS-CONDEMNATION-08: condemnation commands carry the record's
 * optimistic-lock `version`, and asset-service now answers a stale version
 * (409 STALE_VERSION), a self-approval (403 MAKER_CHECKER_VIOLATION) and a bid
 * below the reserve (422 BID_BELOW_FLOOR) synchronously. Map those three known
 * codes to their own copy -- a stale version tells the clerk to reload -- and
 * leave everything else on the generic plain-language message.
 */
const COPY: Record<string, string> = {
  STALE_VERSION: "Someone else has changed this record since you opened it. Refresh the page to load the latest version, then try again.",
  NOT_PENDING: "This record is no longer open for this step. Refresh the page to see its current state.",
  NOT_DRAFT: "This survey has already been submitted. Refresh the page to see its current state.",
  MAKER_CHECKER_VIOLATION: "You created this recommendation, so you cannot approve it. Ask a different authorised officer to approve it.",
  BID_BELOW_FLOOR: "The winning bid is below the auction reserve, so the auction cannot be completed.",
};

export async function condemnationCommand<T>(path: string, init: RequestInit): Promise<T> {
  const res = await browserFetch(path, init);
  if (!res.ok) {
    const code = await errorCodeFromResponse(res);
    throw new Error((code && COPY[code]) || (await errorMessageFromResponse(res)));
  }
  return res.json() as Promise<T>;
}
