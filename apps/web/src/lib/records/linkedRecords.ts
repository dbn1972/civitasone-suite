import { getProcurementGRNById, getProcurementIndentById, getProcurementPOById, getFinanceSanctionById } from "@/app/_data/loaders";
import { parseOpaqueRef } from "@/lib/refs";
import { isUuid } from "./labels";

/**
 * UX-R5 (names, not ids): linked-record references on a record screen ("Against PO/2026/0025 · GRN/2026/0019")
 * resolved to the business number and the in-app link, never "PO c78d6089" or a UUID.
 *
 * A reference may be a bare uuid, an opaque "<type>:<uuid>" ref (CLAUDE.md rule 13) or a hand-typed number.
 * A typed number is shown as-is (no link). A uuid is looked up through the existing detail loaders (tenant-
 * scoped by the session, cached by Next fetch memoisation); if that fails the label is the honest
 * "Purchase order (number not available)" with the link kept, so the officer can still open it.
 * Server-only (loaders use next/headers).
 */

export type LinkedKind = "po" | "indent" | "grn" | "sanction";
export type LinkedRecord = { label: string; href: string | null };

const KIND_NAME: Record<LinkedKind, string> = {
  po: "Purchase order",
  indent: "Indent",
  grn: "GRN",
  sanction: "Sanction",
};

const HREF: Record<LinkedKind, (id: string) => string> = {
  po: (id) => `/procurement/orders/${id}`,
  indent: (id) => `/procurement/indents/${id}`,
  grn: (id) => `/procurement/grn/${id}`,
  sanction: (id) => `/finance/budget/sanctions/${id}`,
};

/** The record id inside a reference, or null when the reference is a hand-typed number. */
export function linkedRecordId(ref: string | null | undefined): string | null {
  const v = (ref ?? "").trim();
  if (!v) return null;
  if (isUuid(v)) return v;
  const parsed = parseOpaqueRef(v);
  return parsed && isUuid(parsed.id) ? parsed.id : null;
}

async function numberFor(kind: LinkedKind, id: string): Promise<string | null> {
  try {
    if (kind === "po") return (await getProcurementPOById(id)).data?.poNo ?? null;
    if (kind === "indent") return (await getProcurementIndentById(id)).data?.indentNo ?? null;
    if (kind === "grn") return (await getProcurementGRNById(id)).data?.grnNo ?? null;
    return (await getFinanceSanctionById(id)).data?.sanctionNo ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve one linked reference. `knownNumber` (a number the source already sent, e.g. a bill poNumber)
 * wins and saves the lookup.
 */
export async function resolveLinkedRecord(kind: LinkedKind, ref: string | null | undefined, knownNumber?: string | null): Promise<LinkedRecord | null> {
  const raw = (ref ?? "").trim();
  const known = (knownNumber ?? "").trim();
  const id = linkedRecordId(raw);
  if (!raw && !known) return null;
  if (known && !isUuid(known)) return { label: known, href: id ? HREF[kind](id) : null };
  if (!id) {
    // A hand-typed reference that is not an id: show it, link nothing; a broken opaque ref shows nothing.
    const parsed = parseOpaqueRef(raw);
    if (!parsed && raw.includes(":")) return null;
    const text = parsed ? parsed.id : raw;
    return text && !isUuid(text) ? { label: text, href: null } : null;
  }
  const no = await numberFor(kind, id);
  const label = no && !isUuid(no) ? no : `${KIND_NAME[kind]} (number not available)`;
  return { label, href: HREF[kind](id) };
}
