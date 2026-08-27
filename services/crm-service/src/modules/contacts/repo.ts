import { eq, and, or, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { contacts, accounts, type ContactRow, type ContactInsert, type ContactView, type ContactDetailView, type AccountInsert } from "./schema.js";
import { deals } from "../deals/schema.js";
import { activities } from "../activities/schema.js";
import { blindIndex } from "../../shared/pii-crypto.js";

function toView(r: ContactRow): ContactView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    designation: r.designation,
    city: r.city,
    country: r.country,
    gstin: r.gstin,
    pan: r.pan,
    pincode: r.pincode,
    temperature: r.temperature,
    priority: r.priority,
    segment: r.segment,
    product: r.product,
    region: r.region,
    expectedValueMinor: r.expectedValueMinor === null || r.expectedValueMinor === undefined ? null : String(r.expectedValueMinor),
    leadStatus: r.leadStatus,
    leadSource: r.leadSource,
    ownerId: r.ownerId,
    accountId: r.accountId,
    tags: (r.tags as string[]) ?? [],
    marketingConsent: r.marketingConsent,
    consentDate: r.consentDate ?? null,
    lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ContactView | null> {
  const rows = await scopedRead((tx) => tx.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function findDetail(id: string, tenantId: string): Promise<ContactDetailView | null> {
  const contact = await findById(id, tenantId);
  if (!contact || contact.status === "inactive") return null;

  const dealRows = await scopedRead((tx) => tx.select().from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.contactId, id), eq(deals.status, "active")))
    .orderBy(desc(deals.updatedAt)));

  const activityRows = await scopedRead((tx) => tx.select().from(activities)
    .where(and(eq(activities.tenantId, tenantId), eq(activities.contactId, id)))
    .orderBy(desc(activities.createdAt))
    .limit(20));

  return {
    id: contact.id,
    name: contact.name,
    ...(contact.company ? { organization: contact.company } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.designation ? { designation: contact.designation } : {}),
    ...(contact.city ? { city: contact.city } : {}),
    // LQ-003 classification/segmentation — must round-trip here or the edit form
    // (which prefills from this endpoint) reloads blank values and then
    // unconditionally PATCHes them back as null, silently wiping real data on save.
    ...(contact.temperature ? { temperature: contact.temperature } : {}),
    ...(contact.priority ? { priority: contact.priority } : {}),
    ...(contact.segment ? { segment: contact.segment } : {}),
    ...(contact.product ? { product: contact.product } : {}),
    ...(contact.region ? { region: contact.region } : {}),
    ...(contact.expectedValueMinor ? { expectedValueMinor: contact.expectedValueMinor } : {}),
    leadStatus: contact.leadStatus,
    marketingConsent: contact.marketingConsent,
    ...(contact.lastActivityAt ? { lastActivityDate: contact.lastActivityAt.slice(0, 10) } : {}),
    tags: contact.tags,
    deals: dealRows.map((d) => ({
      id: d.id,
      dealName: d.name,
      stage: d.stage,
      amount: Number(d.valueMinor),
    })),
    activityTimeline: activityRows.map((a) => ({
      id: a.id,
      type: a.type ?? "note",
      subject: a.subject ?? a.text.slice(0, 80),
      ...(a.dueDate ? { dueDate: a.dueDate } : {}),
      ...(a.completedAt ? { completedAt: a.completedAt.toISOString() } : {}),
      status: a.status ?? "open",
    })),
  };
}

export type ListFilters = {
  search?: string;
  leadStatus?: string;
  ownerId?: string;
  temperature?: string;
  priority?: string;
  segmentName?: string;
  product?: string;
  region?: string;
  leadSource?: string;
  contactStatus?: string;
  expectedValueMin?: string;
  expectedValueMax?: string;
  segment?: "all" | "mine" | "recent";
  actorId?: string;
};

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<ContactView[]> {
  const conditions: SQL[] = [eq(contacts.tenantId, tenantId), sql`${contacts.status} = ${filters.contactStatus ?? 'active'}`];
  if (filters.search) {
    const q = `%${filters.search}%`;
    // email/phone are AES-GCM ciphertext at rest and cannot be ILIKE-matched;
    // search over name + company only. Exact email lookup uses the blind index.
    conditions.push(or(
      ilike(contacts.name, q),
      ilike(contacts.company, q),
    )!);
  }
  if (filters.leadStatus) conditions.push(eq(contacts.leadStatus, filters.leadStatus));
  if (filters.leadSource) conditions.push(eq(contacts.leadSource, filters.leadSource));
  if (filters.temperature) conditions.push(eq(contacts.temperature, filters.temperature));
  if (filters.priority) conditions.push(eq(contacts.priority, filters.priority));
  if (filters.segmentName) conditions.push(eq(contacts.segment, filters.segmentName));
  if (filters.product) conditions.push(eq(contacts.product, filters.product));
  if (filters.region) conditions.push(eq(contacts.region, filters.region));
  if (filters.expectedValueMin) conditions.push(sql`${contacts.expectedValueMinor} >= ${filters.expectedValueMin}::bigint`);
  if (filters.expectedValueMax) conditions.push(sql`${contacts.expectedValueMinor} <= ${filters.expectedValueMax}::bigint`);
  if (filters.ownerId) conditions.push(eq(contacts.ownerId, filters.ownerId));
  if (filters.segment === "mine" && filters.actorId) conditions.push(eq(contacts.ownerId, filters.actorId));
  if (filters.segment === "recent") {
    conditions.push(sql`${contacts.lastActivityAt} > now() - interval '30 days' OR ${contacts.createdAt} > now() - interval '7 days'`);
  }

  const rows = await scopedRead((tx) => tx.select().from(contacts)
    .where(and(...conditions))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

export async function exportAll(tenantId: string, limit = 500, offset = 0): Promise<ContactView[]> {
  const rows = await scopedRead((tx) => tx.select().from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
    .orderBy(contacts.name)
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Derive the blind index for the (optional) email on a write payload. */
function withEmailIdx<T extends { email?: string | null; emailIdx?: string | null }>(row: T): T {
  if (row.email) return { ...row, emailIdx: blindIndex(row.email) };
  if (row.email === null) return { ...row, emailIdx: null };
  return row;
}

export async function insert(tx: Writer, row: ContactInsert): Promise<void> {
  await tx.insert(contacts).values(withEmailIdx(row));
}

/**
 * Per-row insert for bulk import. onConflict (tenant_id, email_idx) does
 * nothing, so a duplicate email is skipped instead of aborting the batch.
 * Returns "inserted" | "skipped" (duplicate).
 */
export async function bulkInsertRow(tx: Writer, row: ContactInsert): Promise<"inserted" | "skipped"> {
  // Bare onConflictDoNothing: the only constraint that can fire is the
  // partial unique index uq_contacts_tenant_email_idx (the PK is a fresh
  // random UUID). A duplicate (tenant_id, email_idx) is silently skipped.
  const res = await (tx as typeof db)
    .insert(contacts)
    .values(withEmailIdx(row))
    .onConflictDoNothing()
    .returning({ id: contacts.id });
  return res.length > 0 ? "inserted" : "skipped";
}

/**
 * Resolve an existing contact by email, INSIDE the caller's transaction.
 *
 * Used by the public lead-capture consumer (LM-002) to decide create vs update. It takes
 * the tx rather than using `scopedRead` on purpose: the lookup and the write that follows
 * must see one snapshot under one RLS scope, otherwise the consumer could resolve a row
 * in a separate transaction and then fail to update it.
 *
 * Matches on the blind index, not the ciphertext — `email` is AES-GCM with a random IV
 * per row, so two encryptions of the same address never compare equal. `blindIndex()`
 * trims + lowercases before the HMAC, so casing and stray whitespace still dedupe.
 */
export async function findIdByEmail(tx: Writer, tenantId: string, email: string): Promise<string | null> {
  const rows = await (tx as typeof db).select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.emailIdx, blindIndex(email))))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve an existing CAPTURE-FORM-ORIGINATED, ACTIVE contact by email, inside the
 * caller's transaction. This is the ONLY lookup the ANONYMOUS public lead-capture path
 * (LM-002) may use to pick an update target.
 *
 * `findIdByEmail` above is deliberately left alone — authenticated callers (merge,
 * dedupe, import) legitimately need to find ANY row with an address. But the form key
 * lives in the tenant's public web page, so on the public path it must be treated as
 * public knowledge. With `findIdByEmail` there, a stranger holding the key plus a
 * victim's email could rewrite that victim's name/phone/company/city/designation and
 * all of their attribution — and, because the capture consumer only ever asserts
 * marketing consent, could stamp `marketing_consent = true` with a server-generated
 * date on a person who never gave consent or explicitly declined. That is consent
 * forgery under the DPDP Act, not a dedupe convenience.
 *
 * The two extra predicates are what close it:
 *   * `capture_form_id IS NOT NULL` — the row must itself have arrived through a public
 *     form. Contacts created by the authenticated UI, bulk import or deal conversion are
 *     out of reach of the anonymous path entirely.
 *   * `status = 'active'` — a soft-deleted contact must not be resurrected and rewritten
 *     by an anonymous caller. Un-deleting is an authenticated, audited decision.
 *
 * Matching is on the blind index for the same reason as `findIdByEmail`: `email` is
 * AES-GCM with a per-row IV, so ciphertext never compares equal.
 */
export async function findCaptureFormLeadIdByEmail(
  tx: Writer,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const rows = await (tx as typeof db).select({ id: contacts.id }).from(contacts)
    .where(and(
      eq(contacts.tenantId, tenantId),
      eq(contacts.emailIdx, blindIndex(email)),
      sql`${contacts.captureFormId} IS NOT NULL`,
      sql`${contacts.status} = 'active'`,
    ))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Tenant-scoped existence check on the caller's transaction (see findIdByEmail). */
export async function idExistsInTx(tx: Writer, tenantId: string, id: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Narrow variant of {@link idExistsInTx} for the ANONYMOUS public capture path: the id
 * must exist AND belong to an active, form-originated row.
 *
 * A separate function rather than extra params on `idExistsInTx`, because widening the
 * existing one would silently change every authenticated caller's semantics. The
 * deterministic contact id the public route derives is guessable by anyone who knows the
 * form key and the prospect's identity, so this fallback needs exactly the same
 * form-origin and liveness guard as the email lookup — otherwise it is a second door
 * into the same consent-forgery vector.
 */
export async function captureFormLeadIdExistsInTx(
  tx: Writer,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: contacts.id }).from(contacts)
    .where(and(
      eq(contacts.tenantId, tenantId),
      eq(contacts.id, id),
      sql`${contacts.captureFormId} IS NOT NULL`,
      sql`${contacts.status} = 'active'`,
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Does ANY row in this tenant hold this email — regardless of origin or status?
 *
 * The public capture consumer needs this to tell "brand new prospect" from "collides
 * with a contact the anonymous path may not touch". In the latter case it must neither
 * update (consent forgery) nor insert (the partial unique index over
 * (tenant_id, email_idx) would abort the transaction), so it needs to know before it
 * writes. Returns a boolean only — no id, nothing that could become an oracle.
 */
export async function emailExistsInTx(tx: Writer, tenantId: string, email: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.emailIdx, blindIndex(email))))
    .limit(1);
  return rows.length > 0;
}

export async function update(tx: Writer, id: string, tenantId: string, patch: Partial<ContactInsert>, actorId: string): Promise<void> {
  await (tx as typeof db).update(contacts)
    .set({ ...withEmailIdx(patch), updatedAt: new Date(), updatedBy: actorId, version: sql`${contacts.version} + 1` })
    .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)));
}

/** Tenant-scoped, non-deleted fetch of the raw row (for merge field-copy). */
export async function findActiveRow(id: string, tenantId: string): Promise<ContactRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
    .limit(1));
  return rows[0] ?? null;
}

export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<void> {
  await update(tx, id, tenantId, { status: "inactive" }, actorId);
}

export async function reassignActivities(tx: Writer, fromId: string, toId: string, tenantId: string): Promise<void> {
  await (tx as typeof db).update(activities)
    .set({ contactId: toId })
    .where(and(eq(activities.contactId, fromId), eq(activities.tenantId, tenantId)));
}

export async function reassignDeals(tx: Writer, fromId: string, toId: string, tenantId: string): Promise<void> {
  await (tx as typeof db).update(deals)
    .set({ contactId: toId })
    .where(and(eq(deals.contactId, fromId), eq(deals.tenantId, tenantId)));
}

export async function touchLastActivity(tx: Writer, id: string, tenantId: string): Promise<void> {
  await (tx as typeof db).update(contacts)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)));
}

export async function insertAccount(tx: Writer, row: AccountInsert): Promise<void> {
  await tx.insert(accounts).values(row);
}

export interface AccountListRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  parentId: string | null;
  contactCount: number;
}

export async function listAccounts(tenantId: string, limit = 500, offset = 0): Promise<AccountListRow[]> {
  const rows = await scopedRead((tx) => tx.select({
    id: accounts.id,
    name: accounts.name,
    industry: accounts.industry,
    website: accounts.website,
    parentId: accounts.parentId,
    contactCount: sql<string>`count(${contacts.id})`,
  })
    .from(accounts)
    .leftJoin(contacts, and(
      eq(contacts.accountId, accounts.id),
      eq(contacts.tenantId, accounts.tenantId),
      eq(contacts.status, "active"),
    ))
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.status, "active")))
    .groupBy(accounts.id, accounts.name, accounts.industry, accounts.website, accounts.parentId)
    .orderBy(accounts.name)
    .limit(limit)
    .offset(offset));
  // count() arrives as a bigint string from pg — normalise to a JSON number.
  return rows.map((r) => ({ ...r, contactCount: Number(r.contactCount ?? 0) }));
}

/** Tenant-scoped existence check for an account (cross-tenant FK guard). */
export async function accountExists(tenantId: string, accountId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ one: sql`1` }).from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, accountId)))
    .limit(1));
  return rows.length > 0;
}

/** Tenant-scoped existence check for a contact (cross-tenant FK guard). */
export async function contactExists(tenantId: string, contactId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ one: sql`1` }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
    .limit(1));
  return rows.length > 0;
}

export { toView };
