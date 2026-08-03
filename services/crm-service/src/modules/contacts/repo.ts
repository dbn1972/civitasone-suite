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
  segment?: "all" | "mine" | "recent";
  actorId?: string;
};

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<ContactView[]> {
  const conditions: SQL[] = [eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`];
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

export async function exportAll(tenantId: string, limit = 5000): Promise<ContactView[]> {
  const rows = await scopedRead((tx) => tx.select().from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
    .orderBy(contacts.name)
    .limit(limit));
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

export async function listAccounts(tenantId: string, limit = 500): Promise<AccountListRow[]> {
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
    .limit(limit));
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
