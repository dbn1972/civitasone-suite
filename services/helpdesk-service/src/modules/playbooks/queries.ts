/**
 * G13 Resolution Playbooks — read-model handlers.
 *
 * All reads go through the Redis read-through cache (cache.getOrLoad); the
 * consumer invalidates the matching resource on every write.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE_PLAYBOOK, RESOURCE_PLAYBOOK_RUN } from "../../topics.js";
import * as repo from "./repo.js";
import {
  computeProgressPct,
  nextStep,
  outstandingMandatorySteps,
  resolvePlaybook,
  rankCandidates,
  specificity,
  stepDueAt,
  type MatchCriteria,
  type PlaybookCandidate,
  type PlaybookStep,
  type RunStepState,
} from "./domain.js";
import type { PlaybookRow, PlaybookRunRow, PlaybookRunStepRow } from "./schema.js";

// ── View shapes (camelCase JSON) ────────────────────────────────────────────

export interface PlaybookView {
  id: string;
  playbookKey: string;
  name: string;
  description: string | null;
  versionNumber: number;
  status: string;
  publishedAt: string | null;
  categoryId: string | null;
  productCode: string | null;
  ticketType: string | null;
  priority: string | null;
  specificity: number;
  steps: PlaybookStep[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RunStepView {
  stepId: string;
  ordinal: number;
  type: string;
  title: string;
  mandatory: boolean;
  slaOffsetMinutes: number | null;
  knowledgeArticleId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  note: string | null;
}

export interface RunView {
  id: string;
  playbookId: string;
  playbookKey: string;
  playbookVersionNumber: number;
  ticketId: string;
  status: string;
  progressPct: number;
  autoAttached: boolean;
  startedAt: string;
  completedAt: string | null;
  version: number;
  steps: RunStepView[];
  nextStepId: string | null;
  outstandingMandatoryStepIds: string[];
}

export function toCandidate(row: PlaybookRow): PlaybookCandidate {
  return {
    id: row.id,
    playbookKey: row.playbookKey,
    versionNumber: row.versionNumber,
    status: row.status as PlaybookCandidate["status"],
    publishedAt: row.publishedAt ?? null,
    categoryId: row.categoryId ?? null,
    productCode: row.productCode ?? null,
    ticketType: row.ticketType ?? null,
    priority: row.priority ?? null,
  };
}

export function playbookView(row: PlaybookRow): PlaybookView {
  return {
    id: row.id,
    playbookKey: row.playbookKey,
    name: row.name,
    description: row.description ?? null,
    versionNumber: row.versionNumber,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    categoryId: row.categoryId ?? null,
    productCode: row.productCode ?? null,
    ticketType: row.ticketType ?? null,
    priority: row.priority ?? null,
    specificity: specificity(toCandidate(row)),
    steps: row.steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function toRunStepState(row: PlaybookRunStepRow): RunStepState {
  return {
    stepId: row.stepId,
    ordinal: row.ordinal,
    mandatory: row.mandatory,
    completedAt: row.completedAt ?? null,
    completedBy: row.completedBy ?? null,
  };
}

export function runView(run: PlaybookRunRow, steps: PlaybookRunStepRow[]): RunView {
  const states = steps.map(toRunStepState);
  const startedAt = run.startedAt;
  return {
    id: run.id,
    playbookId: run.playbookId,
    playbookKey: run.playbookKey,
    playbookVersionNumber: run.playbookVersionNumber,
    ticketId: run.ticketId,
    status: run.status,
    // Recomputed from the step rows rather than trusted from the stored column:
    // the column is a denormalised convenience for list views.
    progressPct: computeProgressPct(states),
    autoAttached: run.autoAttached,
    startedAt: startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    version: run.version,
    steps: steps.map((s) => {
      const due = stepDueAt(startedAt, s.slaOffsetMinutes ?? null);
      return {
        stepId: s.stepId,
        ordinal: s.ordinal,
        type: s.stepType,
        title: s.title,
        mandatory: s.mandatory,
        slaOffsetMinutes: s.slaOffsetMinutes ?? null,
        knowledgeArticleId: s.knowledgeArticleId ?? null,
        dueAt: due ? due.toISOString() : null,
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
        completedBy: s.completedBy ?? null,
        note: s.note ?? null,
      };
    }),
    nextStepId: nextStep(states)?.stepId ?? null,
    outstandingMandatoryStepIds: outstandingMandatorySteps(states).map((s) => s.stepId),
  };
}

// ── Cached reads ────────────────────────────────────────────────────────────

export async function getPlaybook(tenantId: string, id: string): Promise<PlaybookView | null> {
  return cache.getOrLoad<PlaybookView>(cache.makeKey(tenantId, RESOURCE_PLAYBOOK, id), async () => {
    const row = await repo.findPlaybook(id, tenantId);
    return row ? playbookView(row) : null;
  });
}

export async function listPlaybooks(
  tenantId: string,
  opts: { status?: string | undefined; playbookKey?: string | undefined; limit: number; offset: number },
): Promise<PlaybookView[]> {
  const key = cache.makeKey(
    tenantId,
    RESOURCE_PLAYBOOK,
    `list:${opts.status ?? "*"}:${opts.playbookKey ?? "*"}:${opts.limit}:${opts.offset}`,
  );
  const cached = await cache.getOrLoad<{ data: PlaybookView[] }>(key, async () => {
    const rows = await repo.listPlaybooks(tenantId, opts);
    return { data: rows.map(playbookView) };
  });
  return cached?.data ?? [];
}

export interface ResolveResult {
  playbook: PlaybookView | null;
  criteria: MatchCriteria;
  /** Ranked alternatives (best first) so a resolution decision is explainable. */
  candidates: Array<{ id: string; playbookKey: string; versionNumber: number; specificity: number }>;
}

/**
 * Resolve the best-matching published playbook. The candidate set is cached
 * per tenant (invalidated on every playbook write); the ranking itself is a
 * pure function, so the same criteria always produce the same winner.
 */
export async function resolveForCriteria(
  tenantId: string,
  criteria: MatchCriteria,
): Promise<ResolveResult> {
  const key = cache.makeKey(tenantId, RESOURCE_PLAYBOOK, "published");
  const loaded = await cache.getOrLoad<{ data: PlaybookView[] }>(key, async () => {
    const rows = await repo.listPublishedPlaybooks(tenantId);
    return { data: rows.map(playbookView) };
  });
  const data = loaded?.data ?? [];

  const candidates: PlaybookCandidate[] = data.map((v) => ({
    id: v.id,
    playbookKey: v.playbookKey,
    versionNumber: v.versionNumber,
    status: "published",
    publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
    categoryId: v.categoryId,
    productCode: v.productCode,
    ticketType: v.ticketType,
    priority: v.priority,
  }));

  const winner = resolvePlaybook(candidates, criteria);
  const ranked = rankCandidates(candidates, criteria);
  return {
    playbook: winner ? (data.find((v) => v.id === winner.id) ?? null) : null,
    criteria,
    candidates: ranked.map((c) => ({
      id: c.id,
      playbookKey: c.playbookKey,
      versionNumber: c.versionNumber,
      specificity: specificity(c),
    })),
  };
}

export async function getRun(tenantId: string, id: string): Promise<RunView | null> {
  return cache.getOrLoad<RunView>(
    cache.makeKey(tenantId, RESOURCE_PLAYBOOK_RUN, id),
    async () => {
      const run = await repo.findRun(id, tenantId);
      if (!run) return null;
      const steps = await repo.listRunSteps(tenantId, id);
      return runView(run, steps);
    },
  );
}

export async function getRunByTicket(tenantId: string, ticketId: string): Promise<RunView | null> {
  return cache.getOrLoad<RunView>(
    cache.makeKey(tenantId, RESOURCE_PLAYBOOK_RUN, `ticket:${ticketId}`),
    async () => {
      const run = await repo.findRunByTicket(tenantId, ticketId);
      if (!run) return null;
      const steps = await repo.listRunSteps(tenantId, run.id);
      return runView(run, steps);
    },
  );
}
