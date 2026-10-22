"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
import { safeInternalPath } from "./safeUrl";

/**
 * GAP-CRM-DEDUP-RULES-02: guard a form with unsaved edits against BOTH ways of
 * losing them.
 *
 *  - A full page unload (tab close, reload, external link) is covered by the
 *    browser's `beforeunload` prompt, via {@link useUnsavedChangesGuard}.
 *  - An in-app navigation (a sidebar / breadcrumb / "Back" `<a>` or `next/link`)
 *    never fires `beforeunload`. Next's App Router has no supported
 *    navigation-blocking API, so while `dirty` is true this hook intercepts
 *    left-clicks on same-origin anchors in the capture phase (before React's
 *    delegated `Link` handler runs), cancels the navigation and exposes the
 *    intended destination as `pendingHref`. The caller renders its own
 *    confirmation (a `ConfirmDialog`) and calls `leave()` to continue to the
 *    destination via `router.push`, or `stay()` to dismiss.
 *
 * Deliberately NOT intercepted: modified clicks (open in a new tab/window),
 * `target` other than `_self`, `download` links, non-http(s) schemes, other
 * origins (the browser prompt covers those) and same-page hash changes.
 * The browser Back/Forward buttons (history traversal) are not interceptable
 * through a supported API and are not covered.
 */
export interface UnsavedNavigationGuard {
  /** Internal path the user tried to open while there were unsaved edits, else null. */
  pendingHref: string | null;
  /** Dismiss the prompt and stay on the page. */
  stay: () => void;
  /** Leave anyway: continue to the pending destination. */
  leave: () => void;
}

export function useUnsavedNavigationGuard(dirty: boolean): UnsavedNavigationGuard {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Full-page unloads: tab close / reload / external navigation.
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (!dirty) {
      setPendingHref(null);
      return;
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin !== window.location.origin) return;
      // Same page (only the #hash differs): not a navigation away.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(safeInternalPath(`${url.pathname}${url.search}${url.hash}`));
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const stay = useCallback(() => setPendingHref(null), []);
  const leave = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (href) router.push(href);
  }, [pendingHref, router]);

  return { pendingHref, stay, leave };
}
