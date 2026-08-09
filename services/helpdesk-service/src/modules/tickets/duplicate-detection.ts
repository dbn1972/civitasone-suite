/**
 * GRV-004 — Automated duplicate ticket detection.
 *
 * After a new ticket is created, compares its description against recent open
 * tickets in the same tenant. If any score above the similarity threshold,
 * auto-creates "related" link suggestions for the agent to review.
 *
 * Uses tf-idf cosine similarity — same algorithm as citizen-service's
 * complaint clustering (routing/domain.ts), kept local because cross-service
 * imports are not allowed and the logic is ~30 lines.
 */

const SIMILARITY_THRESHOLD = 0.75;
const MAX_SUGGESTIONS = 5;

export interface DuplicateSuggestion {
  ticketId: string;
  similarity: number;
  subject: string;
}

export function findSimilarTickets(
  description: string,
  candidates: Array<{ id: string; subject: string; description: string }>,
): DuplicateSuggestion[] {
  const results: DuplicateSuggestion[] = [];

  for (const candidate of candidates) {
    const similarity = computeTextSimilarity(description, candidate.description);
    if (similarity > SIMILARITY_THRESHOLD) {
      results.push({
        ticketId: candidate.id,
        similarity: Math.round(similarity * 100) / 100,
        subject: candidate.subject.slice(0, 200),
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, MAX_SUGGESTIONS);
}

function computeTextSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = termFrequency(tokensA);
  const freqB = termFrequency(tokensB);

  const allTerms = new Set([...freqA.keys(), ...freqB.keys()]);
  const vecA: number[] = [];
  const vecB: number[] = [];

  for (const term of allTerms) {
    vecA.push(freqA.get(term) ?? 0);
    vecB.push(freqB.get(term) ?? 0);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}
