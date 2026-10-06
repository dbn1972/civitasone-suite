import { normalizeRag, ragLabel, ragPillVariant } from "@/lib/rag";

/**
 * GAP-PROJECTS-DASHBOARD-01 / DELAY-ANALYSIS-01 / LIST-05: a RAG (Red/Amber/
 * Green) health badge that shows BOTH a colour and the word (Green/Amber/Red),
 * so the signal is not conveyed by colour alone (WCAG 1.4.1). Reuses the same
 * `.pill {tone}` CSS classes as StatusPill (good/warn/bad) rather than
 * introducing a parallel colour system. Any value normalizeRag() cannot place
 * is shown as a neutral "—" pill instead of being mis-coloured.
 */
export function RagPill({ rag }: { rag: string | null | undefined }) {
  const normalized = normalizeRag(rag);
  const variant = ragPillVariant(normalized);
  const label = ragLabel(normalized);
  return (
    <span className={`pill ${variant}`} title={`RAG: ${label}`}>
      {label}
    </span>
  );
}
