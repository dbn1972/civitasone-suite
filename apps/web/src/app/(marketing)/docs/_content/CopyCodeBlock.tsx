"use client";

import { useRef, useState } from "react";

interface CopyCodeBlockProps {
  /** The exact text to render and to place on the clipboard when copied. */
  code: string;
  /** Optional extra classes for the <pre> element. */
  className?: string;
}

/**
 * A code block with an accessible copy-to-clipboard button (GAP-DOCS-API-04).
 * Copies the exact `code` text, announces success/failure via an aria-live
 * region, and resets its label after a short delay. Used by the API Reference
 * page and the docs markdown code renderer.
 */
export function CopyCodeBlock({ code, className }: CopyCodeBlockProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleCopy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  const label =
    state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy";

  return (
    <div className={`group relative my-4 ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
        className="absolute end-2 top-2 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs font-medium text-gray-100 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
      >
        {label}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 pt-10 text-sm text-gray-100 font-mono">
        <code>{code}</code>
      </pre>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Code copied to clipboard" : state === "error" ? "Copy failed" : ""}
      </span>
    </div>
  );
}
