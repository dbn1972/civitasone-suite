import { eq, and, desc, ilike, gte, lte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import {
  faqs,
  guidedFlows,
  assistantInteractions,
  type FaqRow,
  type FaqInsert,
  type FlowRow,
  type FlowInsert,
  type InteractionRow,
  type InteractionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

/** Tenant-scoped read: sets the GUC from the JWT-derived tenant so RLS is enforced. */
function readAs<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, () => scopedRead(fn))) as Promise<T>;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

// ── FAQs ────────────────────────────────────────────────────────────
export function faqView(r: FaqRow): Record<string, unknown> {
  return {
    id: r.id,
    question: r.question,
    answer: r.answer,
    category: r.category,
    tags: r.tags ?? [],
    status: r.status,
    viewCount: r.viewCount,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function listFaqs(
  tenantId: string,
  category: string | undefined,
  limit: number,
  offset: number,
): Promise<FaqRow[]> {
  return readAs(tenantId, (tx) =>
    tx.select().from(faqs)
      .where(and(
        eq(faqs.tenantId, tenantId),
        ...(category ? [eq(faqs.category, category)] : []),
      ))
      .orderBy(desc(faqs.updatedAt))
      .limit(limit)
      .offset(offset),
  );
}

export async function getFaq(tenantId: string, id: string): Promise<FaqRow | null> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(faqs).where(and(eq(faqs.id, id), eq(faqs.tenantId, tenantId))),
  );
  return rows[0] ?? null;
}

export async function searchFaqs(tenantId: string, keyword: string, limit: number): Promise<FaqRow[]> {
  return readAs(tenantId, (tx) =>
    tx.select().from(faqs)
      .where(and(
        eq(faqs.tenantId, tenantId),
        eq(faqs.status, "published"),
        ilike(faqs.question, `%${keyword}%`),
      ))
      .limit(limit),
  );
}

export async function insertFaq(tx: Writer, row: FaqInsert): Promise<void> {
  await tx.insert(faqs).values(row);
}
export async function updateFaq(tx: Writer, id: string, data: Partial<FaqInsert>): Promise<void> {
  await tx.update(faqs).set(data).where(eq(faqs.id, id));
}
export async function deleteFaq(tx: Writer, id: string): Promise<void> {
  await tx.delete(faqs).where(eq(faqs.id, id));
}

// ── Guided flows ────────────────────────────────────────────────────
export function flowView(r: FlowRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    steps: r.steps ?? [],
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function listFlows(tenantId: string): Promise<FlowRow[]> {
  return readAs(tenantId, (tx) =>
    tx.select().from(guidedFlows)
      .where(eq(guidedFlows.tenantId, tenantId))
      .orderBy(desc(guidedFlows.updatedAt)),
  );
}

export async function getFlow(tenantId: string, id: string): Promise<FlowRow | null> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(guidedFlows).where(and(eq(guidedFlows.id, id), eq(guidedFlows.tenantId, tenantId))),
  );
  return rows[0] ?? null;
}

export async function insertFlow(tx: Writer, row: FlowInsert): Promise<void> {
  await tx.insert(guidedFlows).values(row);
}
export async function updateFlow(tx: Writer, id: string, data: Partial<FlowInsert>): Promise<void> {
  await tx.update(guidedFlows).set(data).where(eq(guidedFlows.id, id));
}

// ── Interactions ────────────────────────────────────────────────────
export async function insertInteraction(tx: Writer, row: InteractionInsert): Promise<void> {
  await tx.insert(assistantInteractions).values(row);
}

export async function markEscalated(tx: Writer, id: string, ticketRef: string): Promise<void> {
  await tx.update(assistantInteractions)
    .set({ escalated: true, ticketRef })
    .where(eq(assistantInteractions.id, id));
}

export async function listInteractions(
  tenantId: string,
  from: string | undefined,
  to: string | undefined,
): Promise<Pick<InteractionRow, "answered" | "escalated">[]> {
  return readAs(tenantId, (tx) =>
    tx.select({ answered: assistantInteractions.answered, escalated: assistantInteractions.escalated })
      .from(assistantInteractions)
      .where(and(
        eq(assistantInteractions.tenantId, tenantId),
        ...(from ? [gte(assistantInteractions.createdAt, new Date(from))] : []),
        ...(to ? [lte(assistantInteractions.createdAt, new Date(to))] : []),
      )),
  );
}
