"use client";

import { useEffect, useRef } from "react";
import { safeInternalPath } from "./safeUrl";

/**
 * GAP-HR-TRAINING-NEW-05: `useUnsavedChangesGuard` (beforeunload) only covers
 * full-page unloads (tab close, reload, leaving the origin). A same-app
 * `next/link` click is a client-side route change, so no beforeunload fires
 * and a dirty form is silently discarded -- including via the PageHeader back
 * link, which lives outside the form.
 *
 * While `active`, this intercepts left-clicks on same-origin anchors (capture
 * phase on `document`, ahead of next/link's own handler), cancels the
 * navigation and hands the destination to `onBlocked`, which is expected to
 * open a confirm dialog and `router.push(destination)` if the user chooses to
 * discard. Modified clicks (new tab / window / download), `target="_blank"`,
 * external links and same-page (hash-only) links are left alone.
 *
 * Not covered: the browser's own back/forward buttons (popstate) -- the App
 * Router exposes no cancellable event for them.
 */
export function useInAppNavigationGuard(active: boolean, onBlocked: (destination: string) => void): void {
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;

  useEffect(() => {
    if (!active) return;
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      blockedRef.current(safeInternalPath(`${url.pathname}${url.search}${url.hash}`, "/"));
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active]);
}
