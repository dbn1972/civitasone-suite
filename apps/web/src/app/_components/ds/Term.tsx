"use client";

import { HelpTip } from "./HelpTip";
import { explain } from "@/lib/glossary";

/**
 * Term — renders a specialist word followed by a "?" HelpTip whose explanation
 * comes straight from the shared glossary, so the same word always reads the same
 * way everywhere (Requirements 1.2, 1.3, 1.5, 12.1).
 *
 * If the word has no glossary definition, it renders as plain text with no tip,
 * so a clerk never sees an empty or broken explanation (Requirement 2.3).
 *
 * Usage:  <Term name="GRN" />            → "GRN ?"
 *         <Term name="GRN" label="Goods Received Note" />
 */
export function Term({ name, label }: { name: string; label?: string }) {
  const definition = explain(name);
  const text = label ?? name;
  if (!definition) return <>{text}</>;
  return (
    <>
      {text}
      <HelpTip term={name}>{definition}</HelpTip>
    </>
  );
}
