"use client";

import { useEffect } from "react";

/**
 * Removes ?force=1 from the visible address bar using the plain History API
 * (NOT next/navigation's router) so this does not trigger a Next.js
 * navigation/refetch — the already-rendered "filed with force" result stays
 * on screen. This only changes what a later manual refresh would request:
 * after this runs, hitting refresh re-fetches without force=1, so the
 * force_file_24q audit event (fired server-side on every GET with force=1)
 * cannot be silently replayed by reloading the page.
 */
export function StripForceParam() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("force")) {
      url.searchParams.delete("force");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);
  return null;
}
