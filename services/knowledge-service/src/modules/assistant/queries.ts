import * as repo from "./repo.js";
import { deflectionMetrics, type DeflectionMetrics } from "./domain.js";

export async function listFaqs(
  tenantId: string, category: string | undefined, limit: number, offset: number,
  statusFilter?: string,
): Promise<Record<string, unknown>[]> {
  const rows = await repo.listFaqs(tenantId, category, limit, offset, statusFilter);
  return rows.map(repo.faqView);
}

export async function getFaq(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const row = await repo.getFaq(tenantId, id);
  return row ? repo.faqView(row) : null;
}

export async function listFlows(tenantId: string, statusFilter?: string): Promise<Record<string, unknown>[]> {
  const rows = await repo.listFlows(tenantId, statusFilter);
  return rows.map(repo.flowView);
}

export async function getFlow(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const row = await repo.getFlow(tenantId, id);
  return row ? repo.flowView(row) : null;
}

export async function metrics(
  tenantId: string, from: string | undefined, to: string | undefined,
): Promise<DeflectionMetrics> {
  const rows = await repo.listInteractions(tenantId, from, to);
  return deflectionMetrics(rows);
}
