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
