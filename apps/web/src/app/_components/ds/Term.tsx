"use client";

import { HelpTip } from "./HelpTip";
import { explain } from "@/lib/glossary";

/**
 * Term — renders a specialist word followed by a small "?" HelpTip whose
 * explanation comes straight from the shared glossary, so the same word
 * always reads the same way everywhere (Requirements 1.2, 1.3, 1.5, 12.1).
 *
 * If the word has no glossary definition, it renders as plain text with no
 * tip, so a clerk never sees an empty or broken explanation (Requirement 2.3).
 *
 * `before`/`after` attach immediately-adjacent punctuation (wrapping
 * parens, a trailing sentence period, ...) to the word itself, inside the
 * SAME non-breaking unit as its HelpTip icon, rather than the caller
 * splicing raw punctuation around `<Term>` in its own JSX.
 *
 * That hand-splicing was the pre-existing, root-cause pattern behind
 * Issue #21 ("Chart of Accounts (LMMHA ? )", "...RAG status ? .", etc.):
 * the closing ")"/"." was an ordinary sibling text node with no
 * relationship to the icon, so normal inline line-wrapping could -- and in
 * production did -- strand it alone at the start of the next line, and even
 * unwrapped it rendered flush against the icon's edge (HelpTip's button had
 * no marginRight) with zero breathing room, reading as a stray, broken
 * character rather than a help affordance. Passing that punctuation through
 * before/after keeps word + icon + punctuation together as one
 * `white-space: nowrap` unit no matter where the line breaks.
 *
 * Usage:  <Term name="GRN" />                        -> "GRN" + icon
 *         <Term name="GRN" label="Goods Received Note" />
 *         <Term name="LMMHA" before="(" after=")" />  -> "(LMMHA" + icon + ")"
 *         <Term name="RAG" label="RAG status" after="." />
 */
export function Term({
  name,
  label,
  before = "",
  after = "",
}: {
  name: string;
  label?: string;
  before?: string;
  after?: string;
}) {
  const definition = explain(name);
  const text = label ?? name;
  if (!definition) return <>{before}{text}{after}</>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {before}
      {text}
      <HelpTip term={name}>{definition}</HelpTip>
      {after}
    </span>
  );
}
