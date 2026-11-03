"use client";
/**
 * UAT-P2-D3 (A11Y-02, WCAG 2.4.2 Page Titled; GIGW page titles): 863 of 893
 * screens were titled "CivitasOne Suite" -- the static root metadata -- so
 * tabs, history, bookmarks and a screen reader's window list could not tell
 * one screen from another. Only a handful of routes export their own metadata.
 *
 * Every app screen already renders exactly one <h1> (PageHeader's
 * h1#page-heading, guarded by pageHeadingUnique.test.ts), so the shell derives
 * the document title from it: "<page heading> | CivitasOne". A route that
 * sets its own metadata title keeps it -- the sync only replaces the default
 * title or a title it set itself.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** The root layout's static metadata title (app/layout.tsx). */
export const DEFAULT_DOCUMENT_TITLE = "CivitasOne Suite";
export const TITLE_SUFFIX = "CivitasOne";

/** Visible heading text only: help "?" buttons, icons and screen-reader-only extras are not part of the title. */
export function headingText(heading: Element | null): string | null {
  if (!heading) return null;
  const clone = heading.cloneNode(true) as Element;
  clone.querySelectorAll("button, [aria-hidden='true'], .sr-only, svg").forEach((n) => n.remove());
  const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function documentTitleFor(heading: string | null): string | null {
  return heading ? `${heading} | ${TITLE_SUFFIX}` : null;
}

function findHeading(): Element | null {
  return document.querySelector("main h1#page-heading") ?? document.querySelector("main h1");
}

export function PageTitleSync() {
  const pathname = usePathname();
  // Survives client navigations, so a title this component set on the previous
  // screen is recognised as ours (and replaced) rather than as route metadata.
  const lastSetRef = useRef<string | null>(null);

  useEffect(() => {
    let frame: number | null = null;

    const apply = () => {
      frame = null;
      const current = document.title;
      // A route-level metadata title (not the default, not ours): leave it alone.
      if (current && current !== DEFAULT_DOCUMENT_TITLE && current !== lastSetRef.current) return;
      const next = documentTitleFor(headingText(findHeading()));
      if (next && next !== current) {
        document.title = next;
        lastSetRef.current = next;
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(apply);
    };

    apply();
    // Streaming / client data can replace the heading after first paint.
    const main = document.getElementById("main");
    const observer = main ? new MutationObserver(schedule) : null;
    observer?.observe(main as HTMLElement, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
