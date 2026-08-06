/**
 * journeys module — persistence (G1 + G2).
 *
 * Every read goes through {@link scopedRead} so the RLS GUC is set, and every read of a
 * vocabulary/template widens the tenant predicate to include the PLATFORM sentinel tenant:
 * canonical rows are national, so a tenant must be able to see (and derive from) them
 * without owning a copy. The RLS policies in migrations 0079/0080 permit exactly that
 * widening and nothing more.
 */
import { eq, and, or, asc, isNull, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import type { VocabularyEntry, ResolvableTemplate } from "./domain.js";
import { MAX_DERIVATION_DEPTH } from "./domain.js";
import {
  stageVocabulary,
  journeyTemplates,
  PLATFORM_TENANT_ID,
  type Governance,
  type JourneyStep,
  type StageVocabularyRow,
  type StageVocabularyInsert,
  type StageVocabularyView,
  type JourneyTemplateRow,
  type JourneyTemplateInsert,
  type JourneyTemplateView,
  type TemplateStatus,
} from "./schema.js";

export const STAGE_RESOURCE = "stage_vocabulary";
export const TEMPLATE_RESOURCE = "journey_template";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Tenant's own rows plus the national ones. */
function visibleTo(column: typeof stageVocabulary.tenantId | typeof journeyTemplates.tenantId, tenantId: string) {
  return or(eq(column, tenantId), eq(column, PLATFORM_TENANT_ID));
}

// ── Stage vocabulary ───────────────────────────────────────────────────────────

export function toStageView(r: StageVocabularyRow): StageVocabularyView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    stageCode: r.stageCode,
    displayName: r.displayName,
    description: r.description ?? null,
    ordinal: r.ordinal,
    required: r.required,
    governance: r.governance,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findStageById(id: string, tenantId: string): Promise<StageVocabularyView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(stageVocabulary)
    .where(and(
      eq(stageVocabulary.id, id),
      visibleTo(stageVocabulary.tenantId, tenantId),
      isNull(stageVocabulary.deletedAt),
    ))
    .limit(1));
  const row = rows[0];
  return row ? toStageView(row) : null;
}

/** Used to refuse a tenant code that would shadow (or duplicate) an existing one. */
export async function findStageByCode(tenantId: string, stageCode: string): Promise<StageVocabularyView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(stageVocabulary)
    .where(and(
      eq(stageVocabulary.stageCode, stageCode),
      visibleTo(stageVocabulary.tenantId, tenantId),
      isNull(stageVocabulary.deletedAt),
    ))
    .limit(1));
  const row = rows[0];
  return row ? toStageView(row) : null;
}

export interface StageFilter {
  governance?: Governance;
}

export async function listStages(
  tenantId: string,
  limit: number,
  offset: number,
  filter: StageFilter = {},
): Promise<{ rows: StageVocabularyView[]; total: number }> {
  const conds = [visibleTo(stageVocabulary.tenantId, tenantId), isNull(stageVocabulary.deletedAt)];
  if (filter.governance !== undefined) conds.push(eq(stageVocabulary.governance, filter.governance));

  return scopedRead(async (tx) => {
    const rows = await tx.select().from(stageVocabulary)
      .where(and(...conds))
      .orderBy(asc(stageVocabulary.ordinal), asc(stageVocabulary.stageCode))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` }).from(stageVocabulary)
      .where(and(...conds));
    return { rows: rows.map(toStageView), total: counted[0]?.total ?? 0 };
  });
}

/** The effective vocabulary a template is validated against: canonical + this tenant's. */
export async function effectiveVocabulary(tenantId: string): Promise<VocabularyEntry[]> {
  const rows = await scopedRead((tx) => tx.select({
    stageCode: stageVocabulary.stageCode,
    ordinal: stageVocabulary.ordinal,
    required: stageVocabulary.required,
    governance: stageVocabulary.governance,
  })
    .from(stageVocabulary)
    .where(and(visibleTo(stageVocabulary.tenantId, tenantId), isNull(stageVocabulary.deletedAt)))
    .orderBy(asc(stageVocabulary.ordinal)));
  return rows.map((r) => ({
    stageCode: r.stageCode,
    ordinal: r.ordinal,
    required: r.required,
    governance: r.governance,
  }));
}

export async function insertStage(tx: Writer, row: StageVocabularyInsert): Promise<void> {
  await tx.insert(stageVocabulary).values(row);
}

export interface StagePatch {
  displayName?: string;
  description?: string | null;
  ordinal?: number;
  required?: boolean;
}

/** Optimistic locking: false means the version moved under us (409 at the caller). */
export async function updateStageWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: StagePatch,
  actorId: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${stageVocabulary.version} + 1`,
  };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.ordinal !== undefined) set.ordinal = patch.ordinal;
  if (patch.required !== undefined) set.required = patch.required;

  const result = await (tx as typeof db).update(stageVocabulary)
    .set(set)
    .where(and(
      eq(stageVocabulary.id, id),
      eq(stageVocabulary.tenantId, tenantId),
      eq(stageVocabulary.version, expectedVersion),
      eq(stageVocabulary.governance, "tenant"),
      isNull(stageVocabulary.deletedAt),
    ))
    .returning({ id: stageVocabulary.id });
  return result.length > 0;
}

/**
 * Soft delete. The `governance = 'tenant'` predicate is not belt-and-braces: without it a
 * redelivered command could reach the canonical trigger and dead-letter forever instead of
 * failing loudly once at the route.
 */
export async function softDeleteStage(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const result = await (tx as typeof db).update(stageVocabulary)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${stageVocabulary.version} + 1`,
    })
    .where(and(
      eq(stageVocabulary.id, id),
      eq(stageVocabulary.tenantId, tenantId),
      eq(stageVocabulary.governance, "tenant"),
      isNull(stageVocabulary.deletedAt),
    ))
    .returning({ id: stageVocabulary.id });
  return result.length > 0;
}

// ── Journey templates ──────────────────────────────────────────────────────────

export function toTemplateView(r: JourneyTemplateRow): JourneyTemplateView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    templateKey: r.templateKey,
    name: r.name,
    description: r.description ?? null,
    governance: r.governance,
    parentTemplateId: r.parentTemplateId ?? null,
    product: r.product ?? null,
    region: r.region ?? null,
    businessUnit: r.businessUnit ?? null,
    steps: r.steps ?? [],
    versionNumber: r.versionNumber,
    status: r.status,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    deprecatedAt: r.deprecatedAt?.toISOString() ?? null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findTemplateById(id: string, tenantId: string): Promise<JourneyTemplateView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(journeyTemplates)
    .where(and(
      eq(journeyTemplates.id, id),
      visibleTo(journeyTemplates.tenantId, tenantId),
      isNull(journeyTemplates.deletedAt),
    ))
    .limit(1));
  const row = rows[0];
  return row ? toTemplateView(row) : null;
}

/**
 * Same read, but on the CALLER's transaction. A consumer must not call
 * {@link findTemplateById}: `scopedRead` opens its own transaction, so a consumer already
 * inside one would take a second pooled connection and read a snapshot that cannot see its
 * own uncommitted work.
 */
export async function findTemplateByIdTx(
  tx: Writer,
  id: string,
  tenantId: string,
): Promise<JourneyTemplateView | null> {
  const rows = await tx.select()
    .from(journeyTemplates)
    .where(and(
      eq(journeyTemplates.id, id),
      visibleTo(journeyTemplates.tenantId, tenantId),
      isNull(journeyTemplates.deletedAt),
    ))
    .limit(1);
  const row = rows[0];
  return row ? toTemplateView(row) : null;
}

export interface TemplateFilter {
  templateKey?: string;
  status?: TemplateStatus;
  governance?: Governance;
  product?: string;
  region?: string;
  businessUnit?: string;
}

export async function listTemplates(
  tenantId: string,
  limit: number,
  offset: number,
  filter: TemplateFilter = {},
): Promise<{ rows: JourneyTemplateView[]; total: number }> {
  const conds = [visibleTo(journeyTemplates.tenantId, tenantId), isNull(journeyTemplates.deletedAt)];
  if (filter.templateKey !== undefined) conds.push(eq(journeyTemplates.templateKey, filter.templateKey));
  if (filter.status !== undefined) conds.push(eq(journeyTemplates.status, filter.status));
  if (filter.governance !== undefined) conds.push(eq(journeyTemplates.governance, filter.governance));
  // A NULL scope column is a tenant-wide default and matches any requested value, exactly
  // as crm.pipelines scoping does (OP-002).
  if (filter.product !== undefined) {
    conds.push(sql`(${journeyTemplates.product} = ${filter.product} OR ${journeyTemplates.product} IS NULL)`);
  }
  if (filter.region !== undefined) {
    conds.push(sql`(${journeyTemplates.region} = ${filter.region} OR ${journeyTemplates.region} IS NULL)`);
  }
  if (filter.businessUnit !== undefined) {
    conds.push(sql`(${journeyTemplates.businessUnit} = ${filter.businessUnit} OR ${journeyTemplates.businessUnit} IS NULL)`);
  }

  return scopedRead(async (tx) => {
    const rows = await tx.select().from(journeyTemplates)
      .where(and(...conds))
      .orderBy(asc(journeyTemplates.templateKey), asc(journeyTemplates.versionNumber))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` }).from(journeyTemplates)
      .where(and(...conds));
    return { rows: rows.map(toTemplateView), total: counted[0]?.total ?? 0 };
  });
}

/** Highest version number issued for a template key, 0 when the key is new. */
export async function maxVersionNumber(tenantId: string, templateKey: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({
    max: sql<number>`coalesce(max(${journeyTemplates.versionNumber}), 0)::int`,
  })
    .from(journeyTemplates)
    .where(and(eq(journeyTemplates.tenantId, tenantId), eq(journeyTemplates.templateKey, templateKey))));
  return rows[0]?.max ?? 0;
}

/**
 * Load the derivation chain for `id` as a map keyed by template id, walking parent links
 * one row at a time. Bounded by MAX_DERIVATION_DEPTH + 1 queries, so a misconfigured cycle
 * costs eleven cheap primary-key lookups rather than an unbounded loop; the cycle itself is
 * then reported by `buildChain`. A missing parent is simply absent from the map, which is
 * what makes `resolveTemplate` answer PARENT_TEMPLATE_NOT_FOUND instead of pretending.
 */
export async function loadDerivationMap(
  tenantId: string,
  id: string,
): Promise<Map<string, ResolvableTemplate>> {
  const byId = new Map<string, ResolvableTemplate>();
  let currentId: string | null = id;
  let hops = 0;

  while (currentId !== null && hops <= MAX_DERIVATION_DEPTH) {
    if (byId.has(currentId)) break; // cycle — buildChain reports it
    const found = await findTemplateById(currentId, tenantId);
    if (!found) break;
    byId.set(found.id, {
      id: found.id,
      parentTemplateId: found.parentTemplateId,
      steps: found.steps,
    });
    currentId = found.parentTemplateId;
    hops += 1;
  }

  return byId;
}

export async function insertTemplate(tx: Writer, row: JourneyTemplateInsert): Promise<void> {
  await tx.insert(journeyTemplates).values(row);
}

export interface TemplatePatch {
  name?: string;
  description?: string | null;
  steps?: JourneyStep[];
  product?: string | null;
  region?: string | null;
  businessUnit?: string | null;
}

/**
 * Amend a DRAFT template. The `status = 'draft'` predicate is what stops a redelivered
 * update from mutating a definition that has since been published — the 0081 trigger would
 * otherwise reject the write and the message would loop.
 */
export async function updateTemplateWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: TemplatePatch,
  actorId: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${journeyTemplates.version} + 1`,
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.steps !== undefined) set.steps = patch.steps;
  if (patch.product !== undefined) set.product = patch.product;
  if (patch.region !== undefined) set.region = patch.region;
  if (patch.businessUnit !== undefined) set.businessUnit = patch.businessUnit;

  const result = await (tx as typeof db).update(journeyTemplates)
    .set(set)
    .where(and(
      eq(journeyTemplates.id, id),
      eq(journeyTemplates.tenantId, tenantId),
      eq(journeyTemplates.version, expectedVersion),
      eq(journeyTemplates.status, "draft"),
      isNull(journeyTemplates.deletedAt),
    ))
    .returning({ id: journeyTemplates.id });
  return result.length > 0;
}

/** draft → published, in place. Used when the definition has not changed. */
export async function markPublished(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await (tx as typeof db).update(journeyTemplates)
    .set({
      status: "published",
      publishedAt: now,
      updatedAt: now,
      updatedBy: actorId,
      version: sql`${journeyTemplates.version} + 1`,
    })
    .where(and(
      eq(journeyTemplates.id, id),
      eq(journeyTemplates.tenantId, tenantId),
      eq(journeyTemplates.status, "draft"),
      isNull(journeyTemplates.deletedAt),
    ))
    .returning({ id: journeyTemplates.id });
  return result.length > 0;
}

/** published → deprecated. Also used to retire the row a new version supersedes. */
export async function markDeprecated(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await (tx as typeof db).update(journeyTemplates)
    .set({
      status: "deprecated",
      deprecatedAt: now,
      updatedAt: now,
      updatedBy: actorId,
      version: sql`${journeyTemplates.version} + 1`,
    })
    .where(and(
      eq(journeyTemplates.id, id),
      eq(journeyTemplates.tenantId, tenantId),
      eq(journeyTemplates.status, "published"),
      isNull(journeyTemplates.deletedAt),
    ))
    .returning({ id: journeyTemplates.id });
  return result.length > 0;
}

/** Soft delete a draft. Published/deprecated rows are history and stay put. */
export async function softDeleteTemplate(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await (tx as typeof db).update(journeyTemplates)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: actorId,
      version: sql`${journeyTemplates.version} + 1`,
    })
    .where(and(
      eq(journeyTemplates.id, id),
      eq(journeyTemplates.tenantId, tenantId),
      eq(journeyTemplates.status, "draft"),
      isNull(journeyTemplates.deletedAt),
    ))
    .returning({ id: journeyTemplates.id });
  return result.length > 0;
}
