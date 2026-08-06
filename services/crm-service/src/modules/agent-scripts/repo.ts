import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { agentScripts, type AgentScriptRow, type AgentScriptView } from "./schema.js";

type Writer = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toView(r: AgentScriptRow): AgentScriptView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    productCode: r.productCode,
    language: r.language,
    scriptKey: r.scriptKey,
    title: r.title,
    body: r.body,
    versionNumber: r.versionNumber,
    status: r.status,
    tags: (r.tags ?? []) as string[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<AgentScriptView | null> {
  const rows = await db.select().from(agentScripts)
    .where(and(eq(agentScripts.id, id), eq(agentScripts.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0 ? toView(rows[0]!) : null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  productCode?: string,
  language?: string,
): Promise<AgentScriptView[]> {
  const conditions = [eq(agentScripts.tenantId, tenantId)];
  if (productCode) conditions.push(eq(agentScripts.productCode, productCode));
  if (language) conditions.push(eq(agentScripts.language, language));

  const rows = await db.select().from(agentScripts)
    .where(and(...conditions))
    .orderBy(desc(agentScripts.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toView);
}

export async function insert(tx: Writer, row: {
  id: string;
  tenantId: string;
  productCode: string;
  language: string;
  scriptKey: string;
  title: string;
  body: string;
  versionNumber: number;
  status: string;
  tags: string[];
  createdBy: string;
  updatedBy: string;
}): Promise<void> {
  await tx.insert(agentScripts).values({
    id: row.id,
    tenantId: row.tenantId,
    productCode: row.productCode,
    language: row.language,
    scriptKey: row.scriptKey,
    title: row.title,
    body: row.body,
    versionNumber: row.versionNumber,
    status: row.status,
    tags: row.tags,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: 1,
  });
}

export interface AgentScriptPatch {
  title?: string;
  body?: string;
  tags?: string[];
}

export async function updateScript(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: AgentScriptPatch,
  expectedVersion: number,
  actorId: string,
): Promise<boolean> {
  const result = await tx.update(agentScripts)
    .set({
      ...fields,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: expectedVersion + 1,
    })
    .where(and(
      eq(agentScripts.id, id),
      eq(agentScripts.tenantId, tenantId),
      eq(agentScripts.version, expectedVersion),
    ));
  return (result as { rowCount?: number }).rowCount !== 0;
}

export async function setStatus(
  tx: Writer,
  id: string,
  tenantId: string,
  status: string,
  actorId: string,
): Promise<boolean> {
  const result = await tx.update(agentScripts)
    .set({
      status,
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .where(and(eq(agentScripts.id, id), eq(agentScripts.tenantId, tenantId)));
  return (result as { rowCount?: number }).rowCount !== 0;
}

export async function findByIdRaw(tx: Writer, id: string, tenantId: string): Promise<AgentScriptRow | null> {
  const rows = await tx.select().from(agentScripts)
    .where(and(eq(agentScripts.id, id), eq(agentScripts.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0 ? rows[0]! : null;
}
