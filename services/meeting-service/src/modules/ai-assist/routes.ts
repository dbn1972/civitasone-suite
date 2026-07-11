/**
 * AI-assist module — HTTP routes (Fastify plugin `aiAssistRoutes`).
 *
 * Follows the suite CQRS convention (structure.md), mirroring the sibling minutes / decision
 * route shape:
 *   - async AI writes (transcribe / draft-minutes / extract-actions) → resolveContext →
 *     requireRole → zod parse → command publish → 202 { data } (the AI-assist consumer does the
 *     provider work + persistence).
 *   - synchronous AI reads (suggest-agenda / knowledge-base search) → resolveContext →
 *     requireRole → zod parse → invoke the circuit-breaker-wrapped provider / search engine →
 *     200 { data }. These do not mutate state, so they respond directly (like a search query).
 *   - errors → HttpError mapped to the standard envelope by the app-level schema error handler.
 *
 * Safety posture (P37): NONE of these endpoints can publish or approve content. The AI paths only
 * ever queue a job whose consumer writes an editable draft / pending-confirmation candidates — a
 * human must approve minutes and confirm action items through the minutes / action-item modules.
 *
 * Endpoints (6):
 *   POST /v1/meetings/:meetingId/ai/transcribe        trigger transcription (202)
 *   GET  /v1/meetings/:meetingId/ai/transcript        get the stored transcript (200)
 *   POST /v1/meetings/:meetingId/ai/draft-minutes     generate an AI minutes draft (202)
 *   POST /v1/meetings/:meetingId/ai/extract-actions   extract candidate action items (202)
 *   POST /v1/meetings/:meetingId/ai/suggest-agenda    suggest next-meeting agenda (200)
 *   POST /v1/meetings/search/knowledge-base           semantic knowledge-base search (200)
 *
 * _Requirements: 7.2, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { search } from "../../shared/infra.js";
import {
  aiTranscribeSchema,
  aiDraftMinutesSchema,
  aiExtractActionsSchema,
  aiSuggestAgendaSchema,
  knowledgeBaseSearchSchema,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { createAIAdapter, AIUnavailableError, type AgendaSuggestion } from "./adapter.js";
import { classifyMatch } from "./domain.js";

// ─── RBAC (mirrors the minutes module role sets) ─────────────────────────────
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
  "admin",
];
/** AI operations are secretariat-initiated (they prepare material for human review). */
const SECRETARY_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin", "admin"];

const meetingParam = z.object({ meetingId: z.string().uuid() });

/** 404 unless the parent meeting exists in the caller's tenant; returns its status row. */
async function loadMeetingOr404(tenantId: string, meetingId: string): Promise<repo.MeetingStatus> {
  const meeting = await repo.getMeetingStatus(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
  return meeting;
}

export async function aiAssistRoutes(app: FastifyInstance): Promise<void> {
  // ── Trigger transcription (Req 17.x) ─────────────────────────────────────
  app.post("/v1/meetings/:meetingId/ai/transcribe", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = aiTranscribeSchema.parse(req.body);
    await loadMeetingOr404(ctx.tenantId, meetingId);
    const accepted = await commands.aiTranscribe(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Get the stored transcript (Req 17.x) ─────────────────────────────────
  app.get("/v1/meetings/:meetingId/ai/transcript", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    await loadMeetingOr404(ctx.tenantId, meetingId);
    const transcript = await repo.getTranscript(ctx.tenantId, meetingId);
    if (!transcript) throw new HttpError(404, "MEETING_NOT_FOUND", "no transcript for this meeting");
    return reply.send({ data: transcript });
  });

  // ── Generate an AI minutes draft (Req 7.2, 17.x) ─────────────────────────
  app.post("/v1/meetings/:meetingId/ai/draft-minutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = aiDraftMinutesSchema.parse(req.body ?? {});
    await loadMeetingOr404(ctx.tenantId, meetingId);
    const accepted = await commands.aiDraftMinutes(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Extract candidate action items (Req 17.x) ────────────────────────────
  app.post("/v1/meetings/:meetingId/ai/extract-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = aiExtractActionsSchema.parse(req.body ?? {});
    await loadMeetingOr404(ctx.tenantId, meetingId);
    const accepted = await commands.aiExtractActions(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Suggest the next meeting's agenda — synchronous (Req 17.x) ───────────
  app.post("/v1/meetings/:meetingId/ai/suggest-agenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = aiSuggestAgendaSchema.parse(req.body ?? {});
    const meeting = await loadMeetingOr404(ctx.tenantId, meetingId);

    const committeeId = body.committeeId ?? meeting.committeeId ?? null;
    const previousItemTitles = committeeId
      ? await repo.getPreviousAgendaTitles(ctx.tenantId, committeeId, meetingId, body.lookbackMeetings)
      : [];

    const ai = createAIAdapter(ctx.tenantId);
    let suggestions: AgendaSuggestion[] = [];
    let degraded = false;
    try {
      suggestions = await ai.suggestAgenda({
        committeeName: null,
        previousItemTitles,
        openActionDescriptions: [],
      });
    } catch (err) {
      // Graceful degradation: return an empty suggestion set with a degraded flag rather than 5xx.
      if (!(err instanceof AIUnavailableError)) throw err;
      degraded = true;
    }
    return reply.send({ data: { suggestions, degraded } });
  });

  // ── Knowledge-base search — semantic + keyword (Req 17.1–17.6) ───────────
  // Tenant-scoped via the search query. Results are classified exact vs semantic ("related
  // matches", Req 17.6). A search-engine outage degrades to an empty result set (never a 5xx).
  app.post("/v1/meetings/search/knowledge-base", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = knowledgeBaseSearchSchema.parse(req.body);

    try {
      const res = await search.search({
        q: body.q,
        tenantId: ctx.tenantId,
        limit: body.limit,
        offset: body.offset,
        ...(body.committeeId ? { tags: [body.committeeId] } : {}),
      });
      const hits = res.hits.map((h) => ({
        documentId: h.documentId,
        title: h.title,
        excerpt: h.content.slice(0, 280),
        score: h.score ?? null,
        matchType: classifyMatch(body.q, h.title, h.content),
        ...(h.highlights ? { highlights: h.highlights } : {}),
      }));
      return reply.send({ data: { hits, totalHits: res.totalHits, degraded: false } });
    } catch {
      return reply.send({ data: { hits: [], totalHits: 0, degraded: true } });
    }
  });
}
