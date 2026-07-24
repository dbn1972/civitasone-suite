/**
 * Grounded assistant — answers from the knowledge repository (SVC-125 documents)
 * plus published SOPs/policies (SVC-126) and the FAQ store, returning citations
 * (source doc ids). The model call reuses the existing `ai` module adapter.
 */
import { runWithTenant } from "@civitasone/db";
import { sendPrompt, isEnabled, AiAdapterError, CircuitBreakerOpenError } from "../ai/adapter.js";
import * as policyRepo from "../policies/repo.js";
import * as docRepo from "../documents/repo.js";
import * as repo from "./repo.js";
import {
  assembleCitations,
  buildContext,
  extractiveAnswer,
  extractKeyword,
  type GroundingSource,
  type Citation,
} from "./domain.js";

const SYSTEM_PROMPT = `You are the CivitasOne knowledge assistant for government staff.
Answer the user's question using ONLY the provided context (organisational documents, published SOPs/policies and FAQs).
- Be concise and factual.
- If the context does not contain the answer, say you don't have that information and suggest raising a support ticket.
- Never invent policy numbers, dates or names not present in the context.`;

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
  answered: boolean;
  grounded: boolean;
  usedAi: boolean;
}

/** Collect grounding sources for a question across policies, documents and FAQs. */
export async function gatherSources(
  tenantId: string,
  question: string,
  perSource = 5,
): Promise<GroundingSource[]> {
  const keyword = extractKeyword(question);

  const [policies, docs, faqRows] = await Promise.all([
    policyRepo.searchPublished(tenantId, keyword, perSource),
    // The documents repo uses a bare scopedRead; wrap it so the tenant GUC is set.
    Promise.resolve(runWithTenant(tenantId, () => docRepo.searchByTenant(tenantId, keyword, undefined, perSource))),
    repo.searchFaqs(tenantId, keyword, perSource),
  ]);

  const sources: GroundingSource[] = [];
  for (const p of policies) {
    sources.push({ id: p.id, title: p.title, body: p.body ?? "", source: "policy" });
  }
  for (const d of docs) {
    sources.push({ id: d.id, title: d.title, body: "", source: "document" });
  }
  for (const f of faqRows) {
    sources.push({ id: f.id, title: f.question, body: f.answer, source: "faq" });
  }
  return sources;
}

/**
 * Produce a grounded answer + citations. Uses the AI adapter when enabled;
 * otherwise falls back to a deterministic extractive answer from the top source.
 */
export async function answerQuestion(tenantId: string, question: string): Promise<GroundedAnswer> {
  const sources = await gatherSources(tenantId, question);
  const citations = assembleCitations(sources);
  const grounded = sources.length > 0;

  if (!grounded) {
    return { answer: "", citations, answered: false, grounded: false, usedAi: false };
  }

  const context = buildContext(sources);

  if (isEnabled()) {
    try {
      const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;
      const answer = await sendPrompt(SYSTEM_PROMPT, userMessage, { maxTokens: 512 });
      const text = answer.trim();
      if (text.length > 0) {
        return { answer: text, citations, answered: true, grounded: true, usedAi: true };
      }
    } catch (err) {
      if (!(err instanceof AiAdapterError) && !(err instanceof CircuitBreakerOpenError)) {
        throw err;
      }
      // AI unavailable — fall through to extractive answer.
    }
  }

  const extractive = extractiveAnswer(sources);
  return {
    answer: extractive,
    citations,
    answered: extractive.length > 0,
    grounded: true,
    usedAi: false,
  };
}
