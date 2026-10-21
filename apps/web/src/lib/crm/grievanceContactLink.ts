/**
 * GAP-CRM-GRIEVANCES-NEW-01: link a new grievance to an existing CRM contact and
 * warn about a probable duplicate.
 *
 * - searchContacts: async server-side search over GET /v1/crm/contacts/lookup (id,
 *   display name and MASKED phone/email only; crm-service never returns the raw
 *   value from this endpoint). The lookup matches name/organisation, not phone or
 *   email (those are encrypted at rest), so the picker is a name search.
 * - getOpenGrievancesForContact: GET /v1/crm/grievances?contactId=&open=true. A
 *   contact that already has an open grievance is a PROBABLE duplicate; the form
 *   shows it as a non-blocking warning with links. "Open" is status != DISPOSED,
 *   the same definition the grievance stats use.
 *
 * Both reads fail soft: a failed duplicate lookup must never block filing a
 * grievance, so it resolves to an empty list rather than throwing.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import type { EntityOption } from "@/app/_components/ds";
import { duplicateCheck, DuplicateCheckError } from "@/lib/crm/dataQuality";

export async function searchContacts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const q = query.trim();
  const res = await browserFetch(`v1/crm/contacts/lookup?q=${encodeURIComponent(q)}&limit=10`, { signal });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const body = (await res.json()) as {
    data?: Array<{ id?: string; name?: string; email?: string | null; phone?: string | null }>;
  };
  return (body.data ?? [])
    .filter((c): c is { id: string; name: string; email?: string | null; phone?: string | null } => Boolean(c.id && c.name))
    .map((c) => ({
      id: c.id,
      label: c.name,
      ...(c.email || c.phone ? { sublabel: [c.phone, c.email].filter(Boolean).join(" · ") } : {}),
    }));
}

export interface OpenGrievanceRef {
  id: string;
  referenceNo: string;
  subject: string;
}

const MAX_SHOWN = 5;

export async function getOpenGrievancesForContact(
  contactId: string,
  signal?: AbortSignal,
): Promise<{ items: OpenGrievanceRef[]; total: number }> {
  try {
    const res = await browserFetch(
      `v1/crm/grievances?contactId=${encodeURIComponent(contactId)}&open=true&limit=${MAX_SHOWN}`,
      signal ? { signal } : {},
    );
    if (!res.ok) return { items: [], total: 0 };
    const body = (await res.json()) as {
      data?: Array<{ id?: string; referenceNo?: string; subject?: string }>;
      meta?: { total?: number };
    };
    const items = (body.data ?? [])
      .filter((g): g is OpenGrievanceRef => Boolean(g.id && g.referenceNo))
      .map((g) => ({ id: g.id, referenceNo: g.referenceNo, subject: g.subject ?? "" }));
    return { items, total: typeof body.meta?.total === "number" ? body.meta.total : items.length };
  } catch {
    return { items: [], total: 0 };
  }
}

/* ------------------------------------------------------------------------------------------------
 * GAP-CRM-GRIEVANCES-NEW-01: a TYPED phone / email that already belongs to a CRM contact.
 *
 * The picker above is a NAME search (phone and email are encrypted at rest, so GET /contacts/lookup
 * cannot match them), which left a clerk who types a repeat citizen's number with no warning unless
 * they happened to pick the contact by hand. This asks the contact duplicate-check instead - the same
 * endpoint, role gate (CRM roles), tenant scoping and tenant dedup rules the new-contact form uses.
 * It compares the typed value with the decrypted contacts server-side and answers with ids, the contact's
 * display NAME, the matched field NAMES and a score only - never a phone or email - so nothing is learnt
 * here that the clerk's role cannot already see (a contact's name is in the contact list). Only the typed
 * phone / email are sent (never a name), and only once they pass the form's own format check.
 *
 * Everything here is ADVISORY and fails soft: a failed check reports `failed` (the form says it could
 * not check), a refused one (403) reports `forbidden` (the form stops asking, silently), and a failed
 * open-grievance read just leaves that detail out. Filing is never blocked.
 * ---------------------------------------------------------------------------------------------- */

export type ContactMatchField = "phone" | "email";

export interface ExistingContactMatch {
  id: string;
  /** Display name from the duplicate-check answer, or null when the contact has none (the link still works). */
  name: string | null;
  /** Which of the TYPED values matched this contact. */
  matchedOn: ContactMatchField[];
  /** Open grievances already on file for this contact (a probable duplicate), with links. */
  openGrievances: { items: OpenGrievanceRef[]; total: number };
}

export interface ExistingContactResult {
  matches: ExistingContactMatch[];
  /** True = the duplicate check itself could not be completed (NOT "no match"). */
  failed: boolean;
  /**
   * True = the server REFUSED the check (403): this user's role is not allowed to run a contact lookup (for
   * example a tenant_admin who can file grievances but not read contacts). That is not an error to announce and
   * not worth retrying, so the caller stops asking for the rest of the session.
   */
  forbidden?: boolean;
}

/** At most this many matching contacts are shown; more than that is a data-quality problem for the dedup queue. */
const MAX_MATCHES = 3;

export async function findExistingContacts(
  input: { phone?: string; email?: string },
  signal: AbortSignal,
): Promise<ExistingContactResult> {
  const phone = input.phone?.trim();
  const email = input.email?.trim();
  if (!phone && !email) return { matches: [], failed: false };
  let candidates;
  try {
    candidates = await duplicateCheck({ ...(phone ? { phone } : {}), ...(email ? { email } : {}) });
  } catch (err) {
    if (signal.aborted) return { matches: [], failed: false };
    if (err instanceof DuplicateCheckError && err.status === 403) return { matches: [], failed: false, forbidden: true };
    return { matches: [], failed: true };
  }
  if (signal.aborted) return { matches: [], failed: false };
  // Only a match on a value that was actually typed counts (the tenant rules may also weigh other fields).
  const hits = candidates
    .map((c) => ({
      id: c.id,
      // The name comes with the duplicate-check answer itself: no second read of the contact record is needed.
      name: c.name ?? null,
      matchedOn: c.matchedFields.filter((f): f is ContactMatchField => f === "phone" || f === "email"),
    }))
    .filter((c) => c.matchedOn.length > 0)
    .slice(0, MAX_MATCHES);
  const matches = await Promise.all(
    hits.map(async (h): Promise<ExistingContactMatch> => ({
      id: h.id,
      name: h.name,
      matchedOn: h.matchedOn,
      openGrievances: await getOpenGrievancesForContact(h.id, signal),
    })),
  );
  return { matches, failed: false };
}
