import { eq, and, or, ilike, desc, sql, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contacts, accounts, type ContactRow, type ContactInsert, type ContactView, type ContactDetailView, type AccountInsert } from "./schema.js";
import { deals } from "../deals/schema.js";
import { activities } from "../activities/schema.js";

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
  const rows = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findDetail(id: string, tenantId: string): Promise<ContactDetailView | null> {
  const contact = await findById(id, tenantId);
  if (!contact || contact.status === "deleted") return null;

  const dealRows = await db.select().from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.contactId, id), eq(deals.status, "active")))
    .orderBy(desc(deals.updatedAt));

  const activityRows = await db.select().from(activities)
    .where(and(eq(activities.tenantId, tenantId), eq(activities.contactId, id)))
    .orderBy(desc(activities.createdAt))
    .limit(20);

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
  const conditions: SQL[] = [eq(contacts.tenantId, tenantId), sql`${contacts.status} <> 'deleted'`];
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(or(
      ilike(contacts.name, q),
      ilike(contacts.email, q),
      ilike(contacts.company, q),
      ilike(contacts.phone, q),
    )!);
  }
  if (filters.leadStatus) conditions.push(eq(contacts.leadStatus, filters.leadStatus));
  if (filters.ownerId) conditions.push(eq(contacts.ownerId, filters.ownerId));
  if (filters.segment === "mine" && filters.actorId) conditions.push(eq(contacts.ownerId, filters.actorId));
  if (filters.segment === "recent") {
    conditions.push(sql`${contacts.lastActivityAt} > now() - interval '30 days' OR ${contacts.createdAt} > now() - interval '7 days'`);
  }

  const rows = await db.select().from(contacts)
    .where(and(...conditions))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function exportAll(tenantId: string): Promise<ContactView[]> {
  const rows = await db.select().from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} <> 'deleted'`))
    .orderBy(contacts.name);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ContactInsert): Promise<void> {
  await tx.insert(contacts).values(row);
}

export async function bulkInsert(tx: Writer, rows: ContactInsert[]): Promise<void> {
  if (rows.length) await tx.insert(contacts).values(rows);
}

export async function update(tx: Writer, id: string, tenantId: string, patch: Partial<ContactInsert>, actorId: string): Promise<void> {
  await (tx as typeof db).update(contacts)
    .set({ ...patch, updatedAt: new Date(), updatedBy: actorId, version: sql`${contacts.version} + 1` })
    .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)));
}

export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<void> {
  await update(tx, id, tenantId, { status: "deleted" }, actorId);
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

export async function listAccounts(tenantId: string): Promise<{ id: string; name: string; industry: string | null }[]> {
  return db.select({ id: accounts.id, name: accounts.name, industry: accounts.industry })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.status, "active")))
    .orderBy(accounts.name);
}

export { toView };
