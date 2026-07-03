import { NextRequest, NextResponse } from "next/server";
import { GLOSSARY } from "@/lib/glossary";
import { HELP_MODULES } from "@/lib/helpContent";

/**
 * Deterministic keyword-matching RAG endpoint for the AI Assistant.
 * Fast, offline-capable, zero-cost — no external LLM calls.
 *
 * POST /api/proxy/v1/admin/assistant/ask
 * Body: { question: string, context?: { page?: string, module?: string } }
 * Returns: { answer: string, sources: string[] }
 */

interface AskRequest {
  question: string;
  context?: {
    page?: string;
    module?: string;
  };
}

const FALLBACK_ANSWER =
  "I don't have specific help for that. Try the Help Centre or press ? for keyboard shortcuts.";

/**
 * Extract meaningful keywords from a question string.
 * Strips common stop words and short tokens.
 */
function extractKeywords(question: string): string[] {
  const stopWords = new Set([
    "what", "is", "a", "an", "the", "how", "do", "i", "to", "can",
    "you", "me", "my", "in", "on", "of", "for", "and", "or", "it",
    "this", "that", "where", "when", "does", "will", "should", "about",
    "please", "help", "tell", "show", "explain", "mean", "means",
  ]);
  return question
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Search glossary for matching terms and return definitions.
 */
function searchGlossary(keywords: string[]): { term: string; definition: string }[] {
  const results: { term: string; definition: string; score: number }[] = [];

  for (const [term, definition] of Object.entries(GLOSSARY)) {
    const termLower = term.toLowerCase();
    const defLower = definition.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (termLower === kw) score += 10;
      else if (termLower.includes(kw)) score += 5;
      else if (defLower.includes(kw)) score += 2;
    }

    if (score > 0) {
      results.push({ term, definition, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ term, definition }) => ({ term, definition }));
}

/**
 * Search help modules for relevant tasks matching keywords.
 */
function searchHelpModules(
  keywords: string[],
  moduleSlug?: string
): { module: string; task: string; steps: string[] }[] {
  const results: { module: string; task: string; steps: string[]; score: number }[] = [];

  const modulesToSearch = moduleSlug
    ? HELP_MODULES.filter((m) => m.slug === moduleSlug)
    : HELP_MODULES;

  for (const mod of modulesToSearch) {
    for (const task of mod.tasks) {
      const titleLower = task.title.toLowerCase();
      const stepsText = task.steps.join(" ").toLowerCase();
      let score = 0;

      for (const kw of keywords) {
        if (titleLower.includes(kw)) score += 5;
        if (stepsText.includes(kw)) score += 2;
      }

      // Boost if module context matches
      if (moduleSlug && mod.slug === moduleSlug) score += 3;

      if (score > 0) {
        results.push({ module: mod.title, task: task.title, steps: task.steps, score });
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

/**
 * Build a natural-language answer from matched glossary terms and help tasks.
 */
function buildAnswer(
  glossaryMatches: { term: string; definition: string }[],
  taskMatches: { module: string; task: string; steps: string[] }[]
): { answer: string; sources: string[] } {
  const parts: string[] = [];
  const sources: string[] = [];

  if (glossaryMatches.length > 0) {
    for (const { term, definition } of glossaryMatches) {
      parts.push(`**${term}**: ${definition}`);
      sources.push(`Glossary: ${term}`);
    }
  }

  if (taskMatches.length > 0) {
    for (const { module, task, steps } of taskMatches) {
      parts.push(`\n**How to: ${task}** (${module})\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
      sources.push(`Help: ${module} → ${task}`);
    }
  }

  if (parts.length === 0) {
    return { answer: FALLBACK_ANSWER, sources: [] };
  }

  return { answer: parts.join("\n\n"), sources };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AskRequest;
    const { question, context } = body;

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    const keywords = extractKeywords(question);

    if (keywords.length === 0) {
      return NextResponse.json({
        answer: FALLBACK_ANSWER,
        sources: [],
      });
    }

    const glossaryMatches = searchGlossary(keywords);
    const taskMatches = searchHelpModules(keywords, context?.module);
    const { answer, sources } = buildAnswer(glossaryMatches, taskMatches);

    return NextResponse.json({ answer, sources });
  } catch {
    return NextResponse.json(
      { answer: FALLBACK_ANSWER, sources: [] },
      { status: 200 }
    );
  }
}
